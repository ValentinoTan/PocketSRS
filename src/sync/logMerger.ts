/**
 * Event-Sourced Synchronization & Conflict Resolution Engine
 * Implements deterministic append-only review log merging, FSRS-6 scheduling replay,
 * soft-delete tombstones with 30-day auto-purge, and last-write-wins content resolution.
 */

import {
  db,
  DEFAULT_SETTINGS,
  type DeckRecord,
  type NoteRecord,
  type CardRecord,
  type ReviewLogEntry,
  type UserSettingsRecord,
} from '../storage/db';
import { getFSRSInstance } from '../engine/fsrs';
import { Rating, State, createEmptyCard } from 'ts-fsrs';
import { hasMediaInOPFS } from '../storage/opfs';

export interface SyncPayload {
  version: 1;
  deviceId: string;
  timestamp: number;
  settings?: UserSettingsRecord;
  decks: DeckRecord[];
  notes: NoteRecord[];
  cards: CardRecord[];
  revlog: ReviewLogEntry[];
  mediaManifest: string[]; // List of SHA-256 hashes available on sender
}

export interface MergeResult {
  decksUpdated: number;
  notesUpdated: number;
  cardsReplayed: number;
  revlogsMerged: number;
  missingMediaHashes: string[];
  tombstonesPurged: number;
}

const TOMBSTONE_PURGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Replays a card's complete unrevoked review history chronologically through FSRS-6.
 * Generates mathematically consistent stability, difficulty, state, and interval values.
 */
export async function replayCardHistory(
  cardId: string,
  settings: UserSettingsRecord,
  deck?: DeckRecord
): Promise<CardRecord | null> {
  const card = await db.cards.get(cardId);
  if (!card) return null;

  // Retrieve all non-revoked review logs for this card in ascending chronological order
  const logs = await db.revlog
    .where('cardId')
    .equals(cardId)
    .sortBy('reviewTime');

  const validLogs = logs.filter((l) => !l.isRevoked);
  const fsrsEngine = getFSRSInstance(settings, deck);

  if (validLogs.length === 0) {
    // Card has no active reviews; restore to New state
    const emptyCard = createEmptyCard(new Date(card.updatedAt || Date.now()));
    card.state = State.New;
    card.stability = emptyCard.stability;
    card.difficulty = emptyCard.difficulty;
    card.elapsedDays = 0;
    card.scheduledDays = 0;
    card.reps = 0;
    card.lapses = 0;
    card.lastReview = undefined;
    card.due = card.updatedAt || Date.now();
    await db.cards.put(card);
    return card;
  }

  // Seed initial card state
  let currentCard: any = {
    ...createEmptyCard(new Date(validLogs[0].reviewTime)),
    due: new Date(validLogs[0].reviewTime),
    state: State.New,
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    last_review: undefined,
  };

  for (const log of validLogs) {
    const reviewDate = new Date(log.reviewTime);
    const schedule = fsrsEngine.repeat(currentCard, reviewDate);
    const grade = log.rating as unknown as Rating;
    const nextRecord = (schedule as any)[grade];

    if (nextRecord) {
      currentCard = { ...nextRecord.card };
    }
  }

  // Update card record with mathematically consistent replayed values
  card.state = currentCard.state;
  card.stability = currentCard.stability;
  card.difficulty = currentCard.difficulty;
  card.elapsedDays = currentCard.elapsed_days;
  card.scheduledDays = currentCard.scheduled_days;
  card.reps = currentCard.reps;
  card.lapses = currentCard.lapses;
  card.lastReview = currentCard.last_review ? new Date(currentCard.last_review).getTime() : undefined;
  card.due = new Date(currentCard.due).getTime();
  card.updatedAt = Date.now();

  await db.cards.put(card);
  return card;
}

/**
 * Purges soft-delete tombstones that have expired past the 30-day window.
 */
export async function purgeExpiredTombstones(): Promise<number> {
  const cutoff = Date.now() - TOMBSTONE_PURGE_WINDOW_MS;
  let purgedCount = 0;

  // Purge expired decks
  const expiredDecks = await db.decks
    .filter((d) => !!d.deletedAt && d.deletedAt < cutoff)
    .toArray();
  for (const d of expiredDecks) {
    await db.decks.delete(d.id);
    purgedCount++;
  }

  // Purge expired notes
  const expiredNotes = await db.notes
    .filter((n) => !!n.deletedAt && n.deletedAt < cutoff)
    .toArray();
  for (const n of expiredNotes) {
    await db.notes.delete(n.id);
    purgedCount++;
  }

  // Purge expired cards
  const expiredCards = await db.cards
    .filter((c) => !!c.deletedAt && c.deletedAt < cutoff)
    .toArray();
  for (const c of expiredCards) {
    await db.cards.delete(c.id);
    purgedCount++;
  }

  return purgedCount;
}

/**
 * Creates a complete SyncPayload representation of the local database.
 */
export async function exportLocalSyncPayload(deviceId: string): Promise<SyncPayload> {
  const settings = await db.settings.get('global');
  const decks = await db.decks.toArray();
  const notes = await db.notes.toArray();
  const cards = await db.cards.toArray();
  const revlog = await db.revlog.toArray();

  // Collect all media hashes referenced in notes
  const mediaHashes = new Set<string>();
  for (const note of notes) {
    if (note.audioHash) mediaHashes.add(note.audioHash);
    if (note.sentenceAudioHash) mediaHashes.add(note.sentenceAudioHash);
    if (note.imageHash) mediaHashes.add(note.imageHash);
  }

  return {
    version: 1,
    deviceId,
    timestamp: Date.now(),
    settings,
    decks,
    notes,
    cards,
    revlog,
    mediaManifest: Array.from(mediaHashes),
  };
}

/**
 * Merges an incoming SyncPayload into the local Dexie.js database.
 */
export async function mergeSyncPayload(payload: SyncPayload): Promise<MergeResult> {
  let decksUpdated = 0;
  let notesUpdated = 0;
  let revlogsMerged = 0;
  const cardsToReplay = new Set<string>();

  // 1. Merge User Settings (Last-write-wins by updatedAt)
  if (payload.settings) {
    const localSettings = await db.settings.get('global');
    if (!localSettings || (payload.settings.updatedAt || 0) > (localSettings.updatedAt || 0)) {
      await db.settings.put(payload.settings);
    }
  }

  const effectiveSettings = (await db.settings.get('global')) || DEFAULT_SETTINGS;

  // 2. Merge Decks (Last-write-wins & Tombstone propagation)
  for (const incomingDeck of payload.decks) {
    const localDeck = await db.decks.get(incomingDeck.id);
    if (!localDeck) {
      await db.decks.put(incomingDeck);
      decksUpdated++;
    } else if (incomingDeck.updatedAt > (localDeck.updatedAt || 0)) {
      await db.decks.put(incomingDeck);
      decksUpdated++;
    } else if (incomingDeck.deletedAt && !localDeck.deletedAt) {
      localDeck.deletedAt = incomingDeck.deletedAt;
      await db.decks.put(localDeck);
      decksUpdated++;
    }
  }

  // 3. Merge Notes (Last-write-wins & Tombstone propagation)
  for (const incomingNote of payload.notes) {
    const localNote = await db.notes.get(incomingNote.id);
    if (!localNote) {
      await db.notes.put(incomingNote);
      notesUpdated++;
    } else if (incomingNote.updatedAt > (localNote.updatedAt || 0)) {
      await db.notes.put(incomingNote);
      notesUpdated++;
    } else if (incomingNote.deletedAt && !localNote.deletedAt) {
      localNote.deletedAt = incomingNote.deletedAt;
      await db.notes.put(localNote);
      notesUpdated++;
    }
  }

  // 4. Merge Cards (Preserve structural card metadata & tombstones)
  for (const incomingCard of payload.cards) {
    const localCard = await db.cards.get(incomingCard.id);
    if (!localCard) {
      await db.cards.put(incomingCard);
      cardsToReplay.add(incomingCard.id);
    } else {
      if (incomingCard.deletedAt && !localCard.deletedAt) {
        localCard.deletedAt = incomingCard.deletedAt;
        await db.cards.put(localCard);
      }
      if (incomingCard.secondaryDeckIds) {
        const mergedSecondary = Array.from(
          new Set([...(localCard.secondaryDeckIds || []), ...incomingCard.secondaryDeckIds])
        );
        if (mergedSecondary.length !== (localCard.secondaryDeckIds || []).length) {
          localCard.secondaryDeckIds = mergedSecondary;
          await db.cards.put(localCard);
        }
      }
    }
  }

  // 5. Merge Append-Only Review Logs
  for (const incomingLog of payload.revlog) {
    const localLog = await db.revlog.get(incomingLog.id);
    if (!localLog) {
      await db.revlog.put(incomingLog);
      revlogsMerged++;
      cardsToReplay.add(incomingLog.cardId);
    } else if (incomingLog.isRevoked && !localLog.isRevoked) {
      // Undo revocation propagation
      localLog.isRevoked = true;
      await db.revlog.put(localLog);
      revlogsMerged++;
      cardsToReplay.add(incomingLog.cardId);
    }
  }

  // 6. Deterministic Scheduling Replay for affected cards
  let cardsReplayed = 0;
  for (const cardId of cardsToReplay) {
    const card = await db.cards.get(cardId);
    if (card && (!card.deletedAt || card.deletedAt === 0)) {
      const deck = await db.decks.get(card.deckId);
      await replayCardHistory(cardId, effectiveSettings, deck);
      cardsReplayed++;
    }
  }

  // 7. Compute Missing Media Hashes for Differential Media Sync
  const missingMediaHashes: string[] = [];
  for (const hash of payload.mediaManifest) {
    const exists = await hasMediaInOPFS(hash);
    if (!exists) {
      missingMediaHashes.push(hash);
    }
  }

  // 8. Purge expired tombstones
  const tombstonesPurged = await purgeExpiredTombstones();

  return {
    decksUpdated,
    notesUpdated,
    cardsReplayed,
    revlogsMerged,
    missingMediaHashes,
    tombstonesPurged,
  };
}
