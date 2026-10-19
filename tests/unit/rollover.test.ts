import { describe, it, expect } from 'vitest';
import {
  getCurrentLogicalDayStart,
  getNextRollover,
  getLogicalDayKey,
  calculateElapsedDays,
  isCardDue,
  isCardBuried,
} from '../../src/engine/rollover';
import { CardRecord } from '../../src/storage/db';

describe('04:00 AM Logical Day Rollover Engine', () => {
  it('keeps midnight-crossing sessions (23:55 to 00:15) within the same logical day', () => {
    // 23:55 PM on May 10, 2026
    const lateNight = new Date('2026-05-10T23:55:00');
    // 00:15 AM on May 11, 2026 (20 minutes later, past midnight)
    const pastMidnight = new Date('2026-05-11T00:15:00');
    // 03:59 AM on May 11, 2026 (1 minute before cutoff)
    const beforeCutoff = new Date('2026-05-11T03:59:59');

    // All three should map to the logical study day of May 10
    expect(getLogicalDayKey(lateNight, 4)).toBe('2026-05-10');
    expect(getLogicalDayKey(pastMidnight, 4)).toBe('2026-05-10');
    expect(getLogicalDayKey(beforeCutoff, 4)).toBe('2026-05-10');

    // Logical day starts at 04:00 AM on May 10
    const startLate = getCurrentLogicalDayStart(lateNight, 4);
    const startPast = getCurrentLogicalDayStart(pastMidnight, 4);
    expect(startLate.getTime()).toBe(startPast.getTime());
    expect(startPast.getHours()).toBe(4);
    expect(startPast.getDate()).toBe(10);

    // Next rollover cutoff for both is May 11 at 04:00 AM
    const nextLate = getNextRollover(lateNight, 4);
    const nextPast = getNextRollover(pastMidnight, 4);
    expect(nextLate.getTime()).toBe(nextPast.getTime());
    expect(nextPast.getDate()).toBe(11);
    expect(nextPast.getHours()).toBe(4);
  });

  it('triggers logical rollover immediately at 04:00 AM', () => {
    // 03:59:59 AM on May 11 -> logical day May 10
    const before = new Date('2026-05-11T03:59:59');
    // 04:00:00 AM on May 11 -> logical day May 11
    const atCutoff = new Date('2026-05-11T04:00:00');

    expect(getLogicalDayKey(before, 4)).toBe('2026-05-10');
    expect(getLogicalDayKey(atCutoff, 4)).toBe('2026-05-11');

    const cutoffStart = getCurrentLogicalDayStart(atCutoff, 4);
    expect(cutoffStart.getDate()).toBe(11);
    expect(cutoffStart.getHours()).toBe(4);
  });

  it('evaluates card due dates correctly across midnight sessions', () => {
    // A review card scheduled for May 10 at 04:00 AM
    const scheduledDue = new Date('2026-05-10T04:00:00').getTime();
    const card: CardRecord = {
      id: 'test-card-1',
      noteId: 'n1',
      deckId: 'd1',
      direction: 'recognition',
      due: scheduledDue,
      stability: 1.0,
      difficulty: 5.0,
      elapsedDays: 1,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      state: 2, // Review
      isSuspended: false,
      isLeech: false,
      updatedAt: scheduledDue,
    };

    // At 23:55 PM on May 10, card is due
    expect(isCardDue(card, new Date('2026-05-10T23:55:00'), 4)).toBe(true);

    // At 02:30 AM on May 11 (still before 04:00 AM rollover), card remains due in current session
    expect(isCardDue(card, new Date('2026-05-11T02:30:00'), 4)).toBe(true);
  });

  it('unburies cards once rollover cutoff passes', () => {
    const rolloverMs = new Date('2026-05-11T04:00:00').getTime();
    const card: CardRecord = {
      id: 'test-buried-card',
      noteId: 'n1',
      deckId: 'd1',
      direction: 'production',
      due: rolloverMs - 3600000,
      stability: 1.0,
      difficulty: 5.0,
      elapsedDays: 1,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      state: 2,
      isSuspended: false,
      isLeech: false,
      buriedUntil: rolloverMs,
      updatedAt: Date.now(),
    };

    // Buried at 03:00 AM
    expect(isCardBuried(card, new Date('2026-05-11T03:00:00'), 4)).toBe(true);
    expect(isCardDue(card, new Date('2026-05-11T03:00:00'), 4)).toBe(false);

    // Unburied at 04:01 AM
    expect(isCardBuried(card, new Date('2026-05-11T04:01:00'), 4)).toBe(false);
    expect(isCardDue(card, new Date('2026-05-11T04:01:00'), 4)).toBe(true);
  });

  it('calculates elapsed logical days correctly', () => {
    // Review occurred at 10:00 AM on May 1st
    const lastReview = new Date('2026-05-01T10:00:00').getTime();

    // Checked on May 3rd at 02:00 AM (logical day is still May 2nd!)
    const check1 = new Date('2026-05-03T02:00:00');
    expect(calculateElapsedDays(lastReview, check1, 4)).toBe(1);

    // Checked on May 3rd at 10:00 AM (logical day is May 3rd)
    const check2 = new Date('2026-05-03T10:00:00');
    expect(calculateElapsedDays(lastReview, check2, 4)).toBe(2);
  });
});
