import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
  db,
  DEFAULT_SETTINGS,
  type CardRecord,
  type NoteRecord,
  type DeckRecord,
  initializeDatabase,
} from '../../src/storage/db';
import {
  reviewCard,
  undoLastReview,
  previewNextIntervals,
  getFSRSInstance,
} from '../../src/engine/fsrs';
import { getNextRollover } from '../../src/engine/rollover';
import { forgetting_curve, FSRS6_DEFAULT_DECAY } from 'ts-fsrs';

describe('FSRS-6 Memory Scheduling Engine', () => {
  let deckId: string;
  let noteId: string;
  let testDeck: DeckRecord;
  let testNote: NoteRecord;

  beforeEach(async () => {
    await db.delete();
    await db.open();
    await initializeDatabase();

    deckId = uuidv4();
    noteId = uuidv4();

    testDeck = {
      id: deckId,
      name: 'Test Nihongo Deck',
      parentId: null,
      path: 'Test Nihongo Deck',
      language: 'ja-JP',
      newCardsPerDay: 20,
      reviewsPerDay: 200,
      generateTwinCards: true,
      reviewOrder: 'dueFirst',
      updatedAt: Date.now(),
    };
    await db.decks.put(testDeck);

    testNote = {
      id: noteId,
      character: '食べる',
      meaning: 'To eat',
      reading: 'たべる',
      tags: ['verb'],
      updatedAt: Date.now(),
    };
    await db.notes.put(testNote);
  });

  it('verifies FSRS-6 DSR equations and retrievability curve', () => {
    // Retrievability formula check
    // At t = 0, R should be 1.0 (100%)
    const r0 = forgetting_curve(FSRS6_DEFAULT_DECAY, 0, 10);
    expect(r0).toBeCloseTo(1.0, 4);

    // At t = S, retrievability should be close to request retention (approx 0.90)
    const rS = forgetting_curve(FSRS6_DEFAULT_DECAY, 10, 10);
    expect(rS).toBeGreaterThanOrEqual(0.88);
    expect(rS).toBeLessThanOrEqual(0.92);

    // As t increases, R must monotonically decrease
    const r20 = forgetting_curve(FSRS6_DEFAULT_DECAY, 20, 10);
    expect(r20).toBeLessThan(rS);

    // Verify decay parameter is FSRS-6 default (0.1542 in ts-fsrs)
    expect(FSRS6_DEFAULT_DECAY).toBe(0.1542);
  });

  it('correctly calculates next intervals across all 4 rating buttons (Again, Hard, Good, Easy)', async () => {
    const cardId = uuidv4();
    const newCard: CardRecord = {
      id: cardId,
      noteId,
      deckId,
      direction: 'recognition',
      due: Date.now(),
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: 0, // New
      isSuspended: false,
      isLeech: false,
      updatedAt: Date.now(),
    };
    await db.cards.put(newCard);

    const now = new Date('2026-05-10T10:00:00Z');
    const previews = await previewNextIntervals(newCard, DEFAULT_SETTINGS, testDeck, now);

    // 1: Again (relearning / failure)
    expect(previews[1]).toBeDefined();
    expect(previews[1].intervalText).toMatch(/(< 1m|1m)/);
    expect(previews[1].state).toBe(1); // Learning state

    // 2: Hard
    expect(previews[2]).toBeDefined();

    // 3: Good
    expect(previews[3]).toBeDefined();
    expect(previews[3].dueDate.getTime()).toBeGreaterThan(now.getTime());

    // 4: Easy
    expect(previews[4]).toBeDefined();
    expect(previews[4].dueDate.getTime()).toBeGreaterThanOrEqual(previews[3].dueDate.getTime());
  });

  it('automatically buries sibling sister twin cards until the next 04:00 AM rollover upon review', async () => {
    const recognitionCardId = uuidv4();
    const productionCardId = uuidv4();
    const now = new Date('2026-05-10T14:30:00Z');

    const recognitionCard: CardRecord = {
      id: recognitionCardId,
      noteId,
      deckId,
      direction: 'recognition',
      due: now.getTime(),
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      isSuspended: false,
      isLeech: false,
      updatedAt: now.getTime(),
    };

    const productionCard: CardRecord = {
      id: productionCardId,
      noteId,
      deckId,
      direction: 'production',
      due: now.getTime(),
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      isSuspended: false,
      isLeech: false,
      buriedUntil: null,
      updatedAt: now.getTime(),
    };

    await db.cards.bulkPut([recognitionCard, productionCard]);

    // Review the recognition card
    const reviewResult = await reviewCard(recognitionCard, 3, 2500, now);

    // Verify sister production card was returned in buriedSiblings
    expect(reviewResult.buriedSiblings.length).toBe(1);
    expect(reviewResult.buriedSiblings[0].id).toBe(productionCardId);

    // Verify sister card in database has buriedUntil set to 04:00 AM rollover
    const updatedSibling = await db.cards.get(productionCardId);
    expect(updatedSibling?.buriedUntil).toBeDefined();

    const expectedRollover = getNextRollover(now, 4).getTime();
    expect(updatedSibling?.buriedUntil).toBe(expectedRollover);
  });

  it('supports revocable undo: marks review log revoked and restores prior metrics and siblings', async () => {
    const cardId = uuidv4();
    const siblingId = uuidv4();
    const now = new Date('2026-05-10T15:00:00Z');

    const card: CardRecord = {
      id: cardId,
      noteId,
      deckId,
      direction: 'recognition',
      due: now.getTime(),
      stability: 2.5,
      difficulty: 4.8,
      elapsedDays: 2,
      scheduledDays: 3,
      reps: 1,
      lapses: 0,
      state: 2, // Review
      isSuspended: false,
      isLeech: false,
      updatedAt: now.getTime(),
    };

    const sibling: CardRecord = {
      id: siblingId,
      noteId,
      deckId,
      direction: 'production',
      due: now.getTime(),
      stability: 2.0,
      difficulty: 5.0,
      elapsedDays: 2,
      scheduledDays: 3,
      reps: 1,
      lapses: 0,
      state: 2,
      isSuspended: false,
      isLeech: false,
      buriedUntil: null,
      updatedAt: now.getTime(),
    };

    await db.cards.bulkPut([card, sibling]);

    // Review card with 'Again' (Rating 1)
    const { updatedCard, logEntry, buriedSiblings } = await reviewCard(card, 1, 3000, now);
    expect(updatedCard.lapses).toBe(1);
    expect(buriedSiblings.length).toBe(1);

    // Verify sibling is buried
    const buriedSibling = await db.cards.get(siblingId);
    expect(buriedSibling?.buriedUntil).toBeGreaterThan(now.getTime());

    // Execute Undo
    const undoResult = await undoLastReview(cardId);
    expect(undoResult.revokedLog).toBeDefined();
    expect(undoResult.revokedLog?.id).toBe(logEntry.id);
    expect(undoResult.revokedLog?.isRevoked).toBe(true);

    // Verify card state was restored (lapses reverted to 0)
    const restored = await db.cards.get(cardId);
    expect(restored?.lapses).toBe(0);

    // Verify sibling card was unburied
    const restoredSibling = await db.cards.get(siblingId);
    expect(restoredSibling?.buriedUntil).toBeNull();
  });
});
