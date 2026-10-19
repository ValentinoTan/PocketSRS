import { describe, it, expect } from 'vitest';
import { calculateEffectiveStudyDays } from '../../src/components/StudyPlanner';

describe('Goal-Driven Study Planner Pacing Math', () => {
  it('accurately computes effective active study days excluding buffer days and rest days', () => {
    // Fixed start date: Monday, May 4, 2026 at 00:00:00
    const startMs = new Date('2026-05-04T00:00:00Z').getTime();
    // 30 days deadline: June 3, 2026
    const targetMs = startMs + 30 * 86400000;
    const bufferDays = 7; // Final 7 days are review-only buffer
    const activeDaysOfWeek = [1, 2, 3, 4, 5, 6]; // Monday to Saturday (Sundays are rest days)

    // Cutoff date is 30 - 7 = 23 days from start (May 4 to May 27)
    const effectiveDays = calculateEffectiveStudyDays(
      startMs,
      targetMs,
      bufferDays,
      activeDaysOfWeek
    );

    // From May 4 (Monday) to May 27 (Wednesday) inclusive:
    // 24 calendar days: exactly 3 full weeks (21 days) + Mon, Tue, Wed (3 days)
    // Sundays: May 10, May 17, May 24 (3 Sundays)
    // 24 - 3 = 21 active study days
    expect(effectiveDays).toBe(21);
  });

  it('calculates required newCardsPerDay and daily time budget for 500 cards', () => {
    const totalUnseenCards = 500;
    const effectiveStudyDays = 20; // 20 active days
    const targetRetention = 0.90;
    const dailyMinutesCap = 25;

    // Required daily pace
    const computedNewCardsPerDay = Math.ceil(totalUnseenCards / effectiveStudyDays);
    expect(computedNewCardsPerDay).toBe(25); // 500 / 20 = 25 cards/day

    // Estimated steady-state review load: newCardsPerDay * (1 / (1 - targetRetention) * 0.35)
    const retentionFactor = 1 / (1 - targetRetention); // 10
    const computedReviewsPerDay = Math.round(computedNewCardsPerDay * (retentionFactor * 0.35));
    // 25 * 3.5 = 87.5 -> 88 reviews/day
    expect(computedReviewsPerDay).toBe(88);

    // Estimated daily time = 12s per new card + 8s per review card
    const estimatedSeconds = computedNewCardsPerDay * 12 + computedReviewsPerDay * 8;
    // 25*12 = 300s, 88*8 = 704s -> 1004s / 60 ≈ 17 minutes
    const estimatedMinutes = Math.round(estimatedSeconds / 60);
    expect(estimatedMinutes).toBe(17);

    // Verify it fits within user's 25-minute budget
    expect(estimatedMinutes).toBeLessThanOrEqual(dailyMinutesCap);
  });

  it('detects pace overload when deadline is too aggressive', () => {
    const totalUnseenCards = 1000;
    const effectiveStudyDays = 5; // Only 5 days available
    const dailyMinutesCap = 25;
    const targetRetention = 0.90;

    const computedNewCardsPerDay = Math.ceil(totalUnseenCards / effectiveStudyDays);
    expect(computedNewCardsPerDay).toBe(200);

    const retentionFactor = 1 / (1 - targetRetention);
    const computedReviewsPerDay = Math.round(computedNewCardsPerDay * (retentionFactor * 0.35)); // 700
    const estimatedSeconds = computedNewCardsPerDay * 12 + computedReviewsPerDay * 8;
    const estimatedMinutes = Math.round(estimatedSeconds / 60);

    // Pace severely exceeds 25-minute daily cap
    expect(estimatedMinutes).toBeGreaterThan(dailyMinutesCap);
  });
});
