import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
  db,
  type CardRecord,
  type NoteRecord,
  type DeckRecord,
  initializeDatabase,
} from '../../src/storage/db';
import { buildStudyQueue } from '../../src/engine/fsrs';
import { inspectDuplicates, importParsedItems, type ParsedItem } from '../../src/importers/textParser';
import { mergeSyncPayload, type SyncPayload } from '../../src/sync/logMerger';

describe('Database Compound Indices, Tombstones & Duplicate Detection', () => {
  let deck1Id: string;
  let deck2Id: string;

  beforeEach(async () => {
    await db.delete();
    await db.open();
    await initializeDatabase();

    deck1Id = uuidv4();
    deck2Id = uuidv4();

    await db.decks.bulkPut([
      {
        id: deck1Id,
        name: 'Minna Ch 1',
        parentId: null,
        path: 'Minna Ch 1',
        language: 'ja-JP',
        newCardsPerDay: 20,
        reviewsPerDay: 200,
        generateTwinCards: true,
        reviewOrder: 'dueFirst',
        updatedAt: Date.now(),
      },
      {
        id: deck2Id,
        name: 'Minna Ch 2',
        parentId: null,
        path: 'Minna Ch 2',
        language: 'ja-JP',
        newCardsPerDay: 20,
        reviewsPerDay: 200,
        generateTwinCards: true,
        reviewOrder: 'dueFirst',
        updatedAt: Date.now(),
      },
    ]);
  });

  it('verifies compound index query performance on [deckId+due] and [state+due]', async () => {
    const cardsToInsert: CardRecord[] = [];
    const now = Date.now();

    for (let i = 0; i < 300; i++) {
      cardsToInsert.push({
        id: `card-${i}`,
        noteId: `note-${i}`,
        deckId: i % 2 === 0 ? deck1Id : deck2Id,
        direction: 'recognition',
        due: now - (i * 10000),
        stability: 1.5,
        difficulty: 5.0,
        elapsedDays: 1,
        scheduledDays: 1,
        reps: 1,
        lapses: 0,
        state: (i % 3) as 0 | 1 | 2,
        isSuspended: false,
        isLeech: false,
        updatedAt: now,
      });
    }

    await db.cards.bulkPut(cardsToInsert);

    const startTime = performance.now();
    // Query compound index [deckId+state+due]
    const dueInDeck1 = await db.cards
      .where('[deckId+state+due]')
      .between([deck1Id, 2, -Infinity], [deck1Id, 2, now])
      .toArray();
    const queryDuration = performance.now() - startTime;

    expect(dueInDeck1.length).toBeGreaterThan(0);
    // Compound index lookup must be performant
    expect(queryDuration).toBeLessThan(100);
  });

  it('strictly excludes soft-deleted tombstones (deletedAt > 0) from study queues', async () => {
    const noteId = uuidv4();
    const activeCardId = uuidv4();
    const tombstoneCardId = uuidv4();
    const now = Date.now();

    await db.notes.put({
      id: noteId,
      character: '本',
      meaning: 'Book',
      reading: 'ほん',
      tags: [],
      updatedAt: now,
    });

    await db.cards.bulkPut([
      {
        id: activeCardId,
        noteId,
        deckId: deck1Id,
        direction: 'recognition',
        due: now - 1000,
        stability: 1,
        difficulty: 5,
        elapsedDays: 1,
        scheduledDays: 1,
        reps: 1,
        lapses: 0,
        state: 2, // Review due
        isSuspended: false,
        isLeech: false,
        updatedAt: now,
      },
      {
        id: tombstoneCardId,
        noteId,
        deckId: deck1Id,
        direction: 'production',
        due: now - 1000,
        stability: 1,
        difficulty: 5,
        elapsedDays: 1,
        scheduledDays: 1,
        reps: 1,
        lapses: 0,
        state: 2, // Review due but soft-deleted
        isSuspended: false,
        isLeech: false,
        deletedAt: now, // Tombstone
        updatedAt: now,
      },
    ]);

    const queue = await buildStudyQueue({
      deckIds: [deck1Id],
      mode: 'standard',
    });

    const queuedCardIds = queue.combinedQueue.map((c) => c.id);
    expect(queuedCardIds).toContain(activeCardId);
    expect(queuedCardIds).not.toContain(tombstoneCardId);
  });

  it('propagates soft-delete tombstones accurately during peer sync merge', async () => {
    const cardId = uuidv4();
    const noteId = uuidv4();
    const initialTime = Date.now() - 50000;
    const deleteTime = Date.now();

    // Local state: active card
    await db.cards.put({
      id: cardId,
      noteId,
      deckId: deck1Id,
      direction: 'recognition',
      due: initialTime,
      stability: 1,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      state: 2,
      isSuspended: false,
      isLeech: false,
      updatedAt: initialTime,
    });

    // Remote incoming payload: card soft-deleted on another device
    const payload: SyncPayload = {
      version: 1,
      deviceId: 'remote-device-x',
      timestamp: deleteTime,
      decks: [],
      notes: [],
      cards: [
        {
          id: cardId,
          noteId,
          deckId: deck1Id,
          direction: 'recognition',
          due: initialTime,
          stability: 1,
          difficulty: 5,
          elapsedDays: 1,
          scheduledDays: 1,
          reps: 1,
          lapses: 0,
          state: 2,
          isSuspended: false,
          isLeech: false,
          deletedAt: deleteTime,
          updatedAt: deleteTime,
        },
      ],
      revlog: [],
      mediaManifest: [],
    };

    await mergeSyncPayload(payload);

    // Verify local record now holds the tombstone
    const mergedCard = await db.cards.get(cardId);
    expect(mergedCard?.deletedAt).toBe(deleteTime);
  });

  it('detects duplicates on [character+reading] and executes Skip, Merge, and Separate strategies', async () => {
    // 1. Seed existing note in deck1
    const seedNoteId = uuidv4();
    const seedCardId = uuidv4();
    await db.notes.put({
      id: seedNoteId,
      character: '飲む',
      meaning: 'To drink',
      reading: 'のむ',
      tags: ['jlpt-n5'],
      updatedAt: Date.now(),
    });
    await db.cards.put({
      id: seedCardId,
      noteId: seedNoteId,
      deckId: deck1Id,
      secondaryDeckIds: [],
      direction: 'recognition',
      due: Date.now(),
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      isSuspended: false,
      isLeech: false,
      updatedAt: Date.now(),
    });

    // Parsed item with same character & reading
    const duplicateItem: ParsedItem = {
      character: '飲む',
      reading: 'のむ',
      meaning: 'To drink / consume beverage',
      tags: ['verbs'],
    };

    // 2. Test inspectDuplicates
    const previews = await inspectDuplicates([duplicateItem]);
    expect(previews[0].status).toBe('duplicate');
    expect(previews[0].duplicateOfNoteId).toBe(seedNoteId);

    // 3. Test 'skip' strategy: does not create new note
    const skipResult = await importParsedItems([duplicateItem], deck2Id, 'skip');
    expect(skipResult.skipped).toBe(1);
    expect(skipResult.createdNotes).toBe(0);

    // 4. Test 'merge' strategy: appends deck2Id into secondaryDeckIds
    const mergeResult = await importParsedItems([duplicateItem], deck2Id, 'merge');
    expect(mergeResult.mergedCards).toBe(1);

    const mergedCard = await db.cards.get(seedCardId);
    expect(mergedCard?.secondaryDeckIds).toContain(deck2Id);

    // 5. Test 'separate' strategy: creates a new distinct note & card
    const separateResult = await importParsedItems([duplicateItem], deck2Id, 'separate');
    expect(separateResult.createdNotes).toBe(1);
    expect(separateResult.createdCards).toBeGreaterThanOrEqual(1);
  });
});
