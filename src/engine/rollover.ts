import { CardRecord } from '../storage/db';

/**
 * Returns the Date object representing the start of the current logical day.
 * Logical day changes at rolloverHour (default 04:00 AM).
 */
export function getCurrentLogicalDayStart(now: Date = new Date(), rolloverHour: number = 4): Date {
  const date = new Date(now.getTime());
  if (date.getHours() < rolloverHour) {
    date.setDate(date.getDate() - 1);
  }
  date.setHours(rolloverHour, 0, 0, 0);
  return date;
}

/**
 * Returns the timestamp for the next logical day rollover cutoff (e.g. tomorrow at 04:00 AM).
 */
export function getNextRollover(now: Date = new Date(), rolloverHour: number = 4): Date {
  const start = getCurrentLogicalDayStart(now, rolloverHour);
  const next = new Date(start.getTime());
  next.setDate(next.getDate() + 1);
  return next;
}

/**
 * Returns the timestamp for the previous logical day rollover cutoff.
 */
export function getPreviousRollover(now: Date = new Date(), rolloverHour: number = 4): Date {
  return getCurrentLogicalDayStart(now, rolloverHour);
}

/**
 * Checks whether a card is currently buried.
 */
export function isCardBuried(card: CardRecord, now: Date = new Date(), rolloverHour: number = 4): boolean {
  if (!card.buriedUntil) return false;
  return now.getTime() < card.buriedUntil;
}

/**
 * Formats a Date into a string key representing the logical day (YYYY-MM-DD),
 * taking into account the 04:00 AM rollover.
 */
export function getLogicalDayKey(now: Date = new Date(), rolloverHour: number = 4): string {
  const start = getCurrentLogicalDayStart(now, rolloverHour);
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, '0');
  const d = String(start.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Calculates elapsed logical days between a previous review timestamp and the current time.
 */
export function calculateElapsedDays(lastReviewTime: number | undefined, now: Date = new Date(), rolloverHour: number = 4): number {
  if (!lastReviewTime) return 0;
  const lastDate = new Date(lastReviewTime);
  const lastLogicalStart = getCurrentLogicalDayStart(lastDate, rolloverHour);
  const currentLogicalStart = getCurrentLogicalDayStart(now, rolloverHour);
  
  const diffMs = currentLogicalStart.getTime() - lastLogicalStart.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, days);
}

/**
 * Evaluates whether a card is due for study.
 * - Intraday cards (state: 1 Learning, 3 Relearning): due <= now
 * - Interday cards (state: 2 Review): due < nextRollover
 * - New cards (state: 0 New): always eligible subject to new card daily cap
 */
export function isCardDue(card: CardRecord, now: Date = new Date(), rolloverHour: number = 4): boolean {
  if (card.isSuspended || (card.deletedAt && card.deletedAt > 0)) return false;
  if (isCardBuried(card, now, rolloverHour)) return false;

  const nowMs = now.getTime();
  const nextRolloverMs = getNextRollover(now, rolloverHour).getTime();

  // Intraday learning / relearning: due by exact timestamp
  if (card.state === 1 || card.state === 3) {
    return card.due <= nowMs;
  }

  // Interday reviews: due within the current logical day
  if (card.state === 2) {
    return card.due < nextRolloverMs;
  }

  // New cards are due if their due date is within logical day or 0
  return card.due <= nextRolloverMs;
}
