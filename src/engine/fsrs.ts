import {
  fsrs,
  generatorParameters,
  Rating,
  State,
  createEmptyCard,
  forgetting_curve,
  FSRS6_DEFAULT_DECAY,
  type Card,
  type Grade,
} from 'ts-fsrs';
import { v4 as uuidv4 } from 'uuid';
import {
  db,
  DEFAULT_SETTINGS,
  type CardRecord,
  type ReviewLogEntry,
  type UserSettingsRecord,
  type DeckRecord,
  getDeviceId,
} from '../storage/db';
import {
  getCurrentLogicalDayStart,
  getNextRollover,
  isCardBuried,
  calculateElapsedDays,
} from './rollover';

export type StudyMode = 'standard' | 'blitz' | 'high_priority_due_only' | 'cram';

/**
 * Returns a configured ts-fsrs instance using user settings and optional deck overrides.
 */
export function getFSRSInstance(settings: UserSettingsRecord, deck?: DeckRecord) {
  const rawLearning = (deck?.learningSteps && deck.learningSteps.length > 0)
    ? deck.learningSteps
    : (settings?.learningSteps && settings.learningSteps.length > 0)
    ? settings.learningSteps
    : DEFAULT_SETTINGS.learningSteps;
  const learningSteps = rawLearning.map(s => `${s}m` as `${number}m`);

  const rawRelearning = (deck?.relearningSteps && deck.relearningSteps.length > 0)
    ? deck.relearningSteps
    : (settings?.relearningSteps && settings.relearningSteps.length > 0)
    ? settings.relearningSteps
    : DEFAULT_SETTINGS.relearningSteps;
  const relearningSteps = rawRelearning.map(s => `${s}m` as `${number}m`);

  const params = generatorParameters({
    request_retention: settings.requestRetention || 0.90,
    maximum_interval: 36500,
    w: settings.fsrsWeights && settings.fsrsWeights.length === 21
      ? (settings.fsrsWeights as any)
      : undefined,
    enable_short_term: true,
    enable_fuzz: false,
    learning_steps: learningSteps,
    relearning_steps: relearningSteps,
  });

  return fsrs(params);
}

/**
 * Calculates current Retrievability R(t, S) for a card using the FSRS forgetting curve.
 */
export function calculateRetrievability(card: CardRecord, now: Date = new Date(), rolloverHour: number = 4): number {
  if (card.state === 0) return 0; // New cards
  if (card.stability <= 0) return 0.5;

  const elapsedDays = calculateElapsedDays(card.lastReview, now, rolloverHour);
  return forgetting_curve(FSRS6_DEFAULT_DECAY, elapsedDays, card.stability);
}

/**
 * Formats a duration / interval for display on rating buttons (e.g., '1m', '10m', '2d', '1mo').
 */
export function formatInterval(dueDate: Date, now: Date = new Date()): string {
  const diffMs = dueDate.getTime() - now.getTime();
  if (diffMs <= 0) return '< 1m';

  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHours = Math.round(diffMin / 60);
  const diffDays = Math.round(diffHours / 24);

  if (diffMin < 60) return `${Math.max(1, diffMin)}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 30) return `${diffDays}d`;
  if (diffDays < 365) return `${(diffDays / 30).toFixed(1)}mo`;
  return `${(diffDays / 365).toFixed(1)}y`;
}

/**
 * Previews interval text and next state for all 4 ratings (Again, Hard, Good, Easy).
 */
export function previewNextIntervals(
  card: CardRecord,
  settings: UserSettingsRecord,
  deck?: DeckRecord,
  now: Date = new Date()
): Record<1 | 2 | 3 | 4, { intervalText: string; state: number; dueDate: Date }> {
  const f = getFSRSInstance(settings, deck);
  const fsrsCard = cardRecordToFSRSCard(card);

  const repeatResult = f.repeat(fsrsCard, now);

  const grades: (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];
  const previews: Partial<Record<1 | 2 | 3 | 4, { intervalText: string; state: number; dueDate: Date }>> = {};

  for (const grade of grades) {
    const item = repeatResult[grade as Grade];
    if (item) {
      previews[grade] = {
        intervalText: formatInterval(item.card.due, now),
        state: item.card.state as number,
        dueDate: item.card.due,
      };
    } else {
      previews[grade] = {
        intervalText: '1d',
        state: 2,
        dueDate: new Date(now.getTime() + 86400000),
      };
    }
  }

  return previews as Record<1 | 2 | 3 | 4, { intervalText: string; state: number; dueDate: Date }>;
}

/**
 * Converts a CardRecord to a ts-fsrs Card.
 */
export function cardRecordToFSRSCard(card: CardRecord): Card {
  return {
    due: new Date(card.due),
    stability: card.stability || 0,
    difficulty: card.difficulty || 0,
    elapsed_days: card.elapsedDays || 0,
    scheduled_days: card.scheduledDays || 0,
    reps: card.reps || 0,
    lapses: card.lapses || 0,
    state: card.state as State,
    last_review: card.lastReview ? new Date(card.lastReview) : undefined,
    learning_steps: (card as any).learning_steps ?? (card.reps > 0 && (card.state === 1 || card.state === 3) ? 1 : 0),
  };
}

/**
 * Builds the dual-tier study queue:
 * - Intraday Learning Queue (state 1 Learning, state 3 Relearning)
 * - Interday Review Queue (state 2 Review)
 * - New Cards Queue (state 0 New)
 * 
 * Enforces:
 * - 04:00 AM logical rollover
 * - Automated sibling burying checks
 * - Daily review caps and daily new card limits
 * - Sorting order (dueFirst, relativeOverdue, random)
 * - Micro-session presets (Blitz: 15 cards, High-Priority Due Only)
 */
export async function buildStudyQueue(options: {
  deckIds: string[];
  mode?: StudyMode;
  now?: Date;
}): Promise<{
  intradayQueue: CardRecord[];
  interdayQueue: CardRecord[];
  newQueue: CardRecord[];
  combinedQueue: CardRecord[];
  todaysStats: { newStudied: number; reviewsStudied: number };
}> {
  const { deckIds, mode = 'standard', now = new Date() } = options;
  const settings = (await db.settings.get('global')) || {
    id: 'global' as const,
    algorithm: 'fsrs6' as const,
    fsrsWeights: [],
    requestRetention: 0.90,
    dayRolloverHour: 4,
    learningSteps: [1, 10],
    relearningSteps: [10],
    theme: 'light' as const,
    updatedAt: Date.now(),
  };

  const rolloverHour = settings.dayRolloverHour ?? 4;
  const currentLogicalDayStart = getCurrentLogicalDayStart(now, rolloverHour).getTime();
  const nextRolloverMs = getNextRollover(now, rolloverHour).getTime();
  const nowMs = now.getTime();

  // 1. Calculate today's reviews and introduced new cards
  const allTodayLogs = await db.revlog
    .where('reviewTime')
    .aboveOrEqual(currentLogicalDayStart)
    .toArray();

  const validTodayLogs = allTodayLogs.filter((log) => !log.isRevoked);

  const todaysReviews = validTodayLogs.filter((log) => log.state === 2).length;
  // Count cards whose first ever review happened today
  const newCardIds = new Set(validTodayLogs.filter((l) => l.state === 0).map((l) => l.cardId));
  const todaysNew = newCardIds.size;

  // 2. Fetch all cards for the specified deckIds (including secondaryDeckIds)
  const allCards = await db.cards
    .filter((card) => {
      if (card.deletedAt && card.deletedAt > 0) return false;
      if (card.isSuspended) return false;
      if (isCardBuried(card, now, rolloverHour)) return false;

      const matchesPrimary = deckIds.includes(card.deckId);
      const matchesSecondary = card.secondaryDeckIds?.some((id) => deckIds.includes(id)) ?? false;
      return matchesPrimary || matchesSecondary;
    })
    .toArray();

  // Fetch primary deck records for limits and sorting preference
  const decks = await db.decks.where('id').anyOf(deckIds).toArray();
  const primaryDeck = decks[0];
  const dailyNewLimit = primaryDeck?.newCardsPerDay ?? 20;
  const dailyReviewLimit = primaryDeck?.reviewsPerDay ?? 200;
  const reviewOrder = primaryDeck?.reviewOrder ?? 'dueFirst';

  const remainingNewSlots = Math.max(0, dailyNewLimit - todaysNew);
  const remainingReviewSlots = Math.max(0, dailyReviewLimit - todaysReviews);

  // Split into categories
  const intradayDue: CardRecord[] = [];
  const intradayWaiting: CardRecord[] = [];
  const interdayEligible: CardRecord[] = [];
  const newEligible: CardRecord[] = [];

  for (const card of allCards) {
    if (card.state === 1 || card.state === 3) {
      if (card.due <= nowMs) {
        intradayDue.push(card);
      } else {
        intradayWaiting.push(card);
      }
    } else if (card.state === 2) {
      if (card.due < nextRolloverMs) {
        interdayEligible.push(card);
      }
    } else if (card.state === 0) {
      newEligible.push(card);
    }
  }

  // Sort interday eligible cards
  if (reviewOrder === 'random') {
    interdayEligible.sort(() => Math.random() - 0.5);
  } else if (reviewOrder === 'relativeOverdue') {
    interdayEligible.sort((a, b) => {
      const relA = a.scheduledDays > 0 ? a.elapsedDays / a.scheduledDays : 1;
      const relB = b.scheduledDays > 0 ? b.elapsedDays / b.scheduledDays : 1;
      return relB - relA;
    });
  } else {
    // 'dueFirst': sort by Retrievability ascending (most forgotten first), then due date
    interdayEligible.sort((a, b) => {
      const retA = calculateRetrievability(a, now, rolloverHour);
      const retB = calculateRetrievability(b, now, rolloverHour);
      if (retA !== retB) return retA - retB;
      return a.due - b.due;
    });
  }

  // Sort intraday due cards by earliest due timestamp
  intradayDue.sort((a, b) => a.due - b.due);
  intradayWaiting.sort((a, b) => a.due - b.due);

  // Apply daily limits
  const interdayCapped = mode === 'blitz'
    ? interdayEligible.slice(0, 15)
    : interdayEligible.slice(0, remainingReviewSlots);

  const newCapped = (mode === 'blitz' || mode === 'high_priority_due_only')
    ? []
    : newEligible.slice(0, remainingNewSlots);

  let combined: CardRecord[] = [];

  if (mode === 'cram') {
    // Non-Destructive Cram Mode: drill all cards in selected deck/chapter/book ahead of exams
    combined = [...allCards];
    // Shuffle slightly or order by state
    combined.sort((a, b) => a.state - b.state);
  } else if (mode === 'blitz') {
    // Micro-Session: Quick 2-Minute Blitz (15 Cards)
    // Combines due intraday and most urgent reviews, capped at 15
    const pool = [...intradayDue, ...interdayEligible];
    pool.sort((a, b) => {
      const retA = calculateRetrievability(a, now, rolloverHour);
      const retB = calculateRetrievability(b, now, rolloverHour);
      return retA - retB;
    });
    combined = pool.slice(0, 15);
  } else if (mode === 'high_priority_due_only') {
    // Micro-Session: High-Priority Due Only (sort strictly by lowest retrievability)
    const pool = [...intradayDue, ...interdayCapped];
    pool.sort((a, b) => {
      const retA = calculateRetrievability(a, now, rolloverHour);
      const retB = calculateRetrievability(b, now, rolloverHour);
      return retA - retB;
    });
    combined = pool;
  } else {
    // Standard dual-tier session:
    // 1. Ready intraday learning cards
    // 2. Interday reviews
    // 3. New cards
    // 4. Waiting intraday cards (re-checked as session progresses)
    combined = [...intradayDue, ...interdayCapped, ...newCapped, ...intradayWaiting];
  }

  return {
    intradayQueue: mode === 'cram' ? [] : [...intradayDue, ...intradayWaiting],
    interdayQueue: mode === 'cram' ? allCards : interdayCapped,
    newQueue: mode === 'cram' ? [] : newCapped,
    combinedQueue: combined,
    todaysStats: {
      newStudied: todaysNew,
      reviewsStudied: todaysReviews,
    },
  };
}

/**
 * Scans notes for the given deck and creates missing Meaning -> Character twin cards.
 */
export async function generateTwinCardsForDeck(deckId: string): Promise<number> {
  const cards = await db.cards.where('deckId').equals(deckId).toArray();
  const validCards = cards.filter((c) => !c.deletedAt || c.deletedAt === 0);

  const noteIdToDirections = new Map<string, Set<string>>();
  for (const c of validCards) {
    if (!noteIdToDirections.has(c.noteId)) {
      noteIdToDirections.set(c.noteId, new Set());
    }
    noteIdToDirections.get(c.noteId)!.add(c.direction);
  }

  let createdCount = 0;
  const now = Date.now();

  for (const [noteId, dirs] of noteIdToDirections.entries()) {
    if (!dirs.has('production')) {
      const twinCard: CardRecord = {
        id: uuidv4(),
        noteId,
        deckId,
        direction: 'production',
        due: now,
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        state: 0,
        isSuspended: false,
        isLeech: false,
        updatedAt: now,
      };
      await db.cards.put(twinCard);
      createdCount++;
    }
  }

  return createdCount;
}


/**
 * Reviews a card with a rating (1: Again, 2: Hard, 3: Good, 4: Easy).
 * - Applies FSRS-6 algorithm (or SM-2 fallback)
 * - Detects leeches (>=4 consecutive Again ratings)
 * - Automatically buries sibling cards sharing the same noteId
 * - Records an immutable ReviewLogEntry
 */
export async function reviewCard(
  card: CardRecord,
  rating: 1 | 2 | 3 | 4,
  elapsedMs: number,
  now: Date = new Date(),
  isCram: boolean = false
): Promise<{
  updatedCard: CardRecord;
  logEntry: ReviewLogEntry;
  buriedSiblings: CardRecord[];
}> {
  const settings = (await db.settings.get('global')) || DEFAULT_SETTINGS;

  const deck = await db.decks.get(card.deckId);
  const rolloverHour = settings.dayRolloverHour ?? 4;
  const nowMs = now.getTime();
  const nextRolloverMs = getNextRollover(now, rolloverHour).getTime();

  let nextDue: number;
  let nextStability: number;
  let nextDifficulty: number;
  let nextElapsedDays: number;
  let nextScheduledDays: number;
  let nextReps: number;
  let nextLapses: number;
  let nextState: 0 | 1 | 2 | 3;
  let nextLearningStep: number | undefined;

  if (settings.algorithm === 'sm2') {
    // Classic SM-2 Fallback
    nextReps = card.reps + 1;
    nextLapses = rating === 1 ? card.lapses + 1 : card.lapses;
    let ease = Math.round(card.difficulty ? 1000 - card.difficulty * 70 : 2500);

    if (rating === 1) {
      nextScheduledDays = 0;
      nextDue = nowMs + 10 * 60 * 1000; // 10 min
      nextState = 1;
      ease = Math.max(1300, ease - 200);
    } else if (rating === 2) {
      nextScheduledDays = Math.max(1, Math.round((card.scheduledDays || 1) * 1.2));
      const targetDate = new Date(getNextRollover(now, rolloverHour).getTime() + (nextScheduledDays - 1) * 86400000);
      nextDue = targetDate.getTime();
      nextState = 2;
      ease = Math.max(1300, ease - 150);
    } else if (rating === 3) {
      nextScheduledDays = card.reps === 0 ? 1 : card.reps === 1 ? 6 : Math.max(1, Math.round((card.scheduledDays || 1) * (ease / 1000)));
      const targetDate = new Date(getNextRollover(now, rolloverHour).getTime() + (nextScheduledDays - 1) * 86400000);
      nextDue = targetDate.getTime();
      nextState = 2;
    } else {
      nextScheduledDays = card.reps === 0 ? 4 : Math.max(1, Math.round((card.scheduledDays || 1) * (ease / 1000) * 1.3));
      const targetDate = new Date(getNextRollover(now, rolloverHour).getTime() + (nextScheduledDays - 1) * 86400000);
      nextDue = targetDate.getTime();
      nextState = 2;
      ease = Math.min(3000, ease + 150);
    }
    nextStability = nextScheduledDays;
    nextDifficulty = Math.max(1, Math.min(10, (3000 - ease) / 200));
    nextElapsedDays = calculateElapsedDays(card.lastReview, now, rolloverHour);
  } else {
    // FSRS-6 Algorithm
    const f = getFSRSInstance(settings, deck);
    const fsrsCard = cardRecordToFSRSCard(card);
    const repeatResult = f.repeat(fsrsCard, now);
    const recordItem = repeatResult[rating as Grade];

    const resultCard = recordItem.card;
    nextStability = resultCard.stability;
    nextDifficulty = resultCard.difficulty;
    nextElapsedDays = resultCard.elapsed_days;
    nextScheduledDays = resultCard.scheduled_days;
    nextReps = resultCard.reps;
    nextLapses = resultCard.lapses;
    nextState = resultCard.state as 0 | 1 | 2 | 3;
    nextLearningStep = resultCard.learning_steps;

    // Interday reviews (scheduledDays >= 1): align against logical 04:00 AM rollover
    if (nextScheduledDays >= 1 && nextState === 2) {
      const targetRollover = new Date(getCurrentLogicalDayStart(now, rolloverHour).getTime());
      targetRollover.setDate(targetRollover.getDate() + nextScheduledDays);
      nextDue = targetRollover.getTime();
    } else {
      nextDue = resultCard.due.getTime();
    }
  }

  // Leech detection: lapses >= leechThreshold
  const leechThreshold = settings.leechThreshold ?? 4;
  const isNewlyLeeched = rating === 1 && nextLapses >= leechThreshold && !card.isLeech;
  const isLeech = isNewlyLeeched || card.isLeech;
  let isSuspended = card.isSuspended;
  let isFlagged = card.isFlagged;

  if (isNewlyLeeched) {
    if (settings.leechAction === 'suspend') {
      isSuspended = true;
    } else {
      isFlagged = 'red';
    }
  }

  const updatedCard: CardRecord = {
    ...card,
    due: nextDue,
    stability: nextStability,
    difficulty: nextDifficulty,
    elapsedDays: nextElapsedDays,
    scheduledDays: nextScheduledDays,
    reps: nextReps,
    lapses: nextLapses,
    state: nextState,
    lastReview: nowMs,
    isLeech,
    isSuspended,
    isFlagged,
    updatedAt: nowMs,
  };
  (updatedCard as any).learning_steps = nextLearningStep;

  // Create immutable review log entry
  const logEntry: ReviewLogEntry = {
    id: uuidv4(),
    cardId: card.id,
    rating,
    state: card.state,
    reviewTime: nowMs,
    elapsedMs,
    scheduledDays: nextScheduledDays,
    deviceId: getDeviceId(),
    isRevoked: false,
  };

  const buriedSiblings: CardRecord[] = [];

  // If NOT in non-destructive Cram Mode, persist state & bury siblings
  if (!isCram) {
    await db.cards.put(updatedCard);
    await db.revlog.put(logEntry);

    // Automated Sibling Card Burying
    const siblings = await db.cards.where('noteId').equals(card.noteId).toArray();
    for (const sibling of siblings) {
      if (sibling.id !== card.id) {
        const buriedCard: CardRecord = {
          ...sibling,
          buriedUntil: nextRolloverMs,
          updatedAt: nowMs,
        };
        await db.cards.put(buriedCard);
        buriedSiblings.push(buriedCard);
      }
    }
  }

  return {
    updatedCard,
    logEntry,
    buriedSiblings,
  };
}

/**
 * Deterministically replays a card from its creation to its current state
 * by executing all non-revoked ReviewLogEntry records in chronological order.
 */
export function replayCardFromLogs(
  card: CardRecord,
  settings: UserSettingsRecord,
  logs: ReviewLogEntry[],
  deck?: DeckRecord
): CardRecord {
  const f = getFSRSInstance(settings, deck);
  const rolloverHour = settings.dayRolloverHour ?? 4;

  let currentCard: Card = {
    due: new Date(0),
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    state: State.New,
    last_review: undefined,
    learning_steps: 0,
  };

  const validLogs = logs
    .filter((l) => !l.isRevoked)
    .sort((a, b) => a.reviewTime - b.reviewTime);

  for (const log of validLogs) {
    const revDate = new Date(log.reviewTime);
    const repeatResult = f.repeat(currentCard, revDate);
    const item = repeatResult[log.rating as Grade];
    if (item) {
      currentCard = item.card;
    }
  }

  let finalDue: number;
  if (currentCard.scheduled_days >= 1 && currentCard.state === State.Review && currentCard.last_review) {
    const targetRollover = new Date(getCurrentLogicalDayStart(currentCard.last_review, rolloverHour).getTime());
    targetRollover.setDate(targetRollover.getDate() + currentCard.scheduled_days);
    finalDue = targetRollover.getTime();
  } else {
    finalDue = currentCard.due.getTime();
  }

  const replayed: CardRecord = {
    ...card,
    due: validLogs.length === 0 ? Date.now() : finalDue,
    stability: currentCard.stability,
    difficulty: currentCard.difficulty,
    elapsedDays: currentCard.elapsed_days,
    scheduledDays: currentCard.scheduled_days,
    reps: currentCard.reps,
    lapses: currentCard.lapses,
    state: currentCard.state as 0 | 1 | 2 | 3,
    lastReview: currentCard.last_review?.getTime(),
    isLeech: currentCard.lapses >= 4,
    updatedAt: Date.now(),
  };
  (replayed as any).learning_steps = currentCard.learning_steps;

  return replayed;
}

/**
 * Revocable Undo:
 * Finds the latest non-revoked ReviewLogEntry, sets `isRevoked: true`,
 * and restores the card's prior state by replaying remaining logs.
 * Also unburies sibling cards if they were buried until nextRollover.
 */
export async function undoLastReview(cardId?: string): Promise<{
  restoredCard: CardRecord | null;
  revokedLog: ReviewLogEntry | null;
  unburiedSiblings: CardRecord[];
}> {
  let query = db.revlog.toCollection();
  const allLogs = await query.toArray();

  // Find most recent non-revoked log
  const nonRevokedLogs = allLogs
    .filter((l) => !l.isRevoked && (!cardId || l.cardId === cardId))
    .sort((a, b) => b.reviewTime - a.reviewTime);

  const targetLog = nonRevokedLogs[0];
  if (!targetLog) {
    return { restoredCard: null, revokedLog: null, unburiedSiblings: [] };
  }

  // 1. Mark target log as revoked
  targetLog.isRevoked = true;
  await db.revlog.put(targetLog);

  // 2. Fetch card and settings
  const card = await db.cards.get(targetLog.cardId);
  if (!card) {
    return { restoredCard: null, revokedLog: targetLog, unburiedSiblings: [] };
  }

  const settings = (await db.settings.get('global')) || DEFAULT_SETTINGS;

  const deck = await db.decks.get(card.deckId);

  // 3. Replay card history without the revoked log
  const cardLogs = await db.revlog.where('cardId').equals(card.id).toArray();
  const restoredCard = replayCardFromLogs(card, settings, cardLogs, deck);
  await db.cards.put(restoredCard);

  // 4. Unbury sibling cards
  const siblings = await db.cards.where('noteId').equals(card.noteId).toArray();
  const unburiedSiblings: CardRecord[] = [];

  for (const sibling of siblings) {
    if (sibling.id !== card.id && sibling.buriedUntil) {
      const unburied = {
        ...sibling,
        buriedUntil: null,
        updatedAt: Date.now(),
      };
      await db.cards.put(unburied);
      unburiedSiblings.push(unburied);
    }
  }

  return {
    restoredCard,
    revokedLog: targetLog,
    unburiedSiblings,
  };
}

/**
 * Backlog Load Balancer (PRD §5.4)
 * Redistributes overdue review cards across a 3 to 7 day recovery schedule,
 * preventing review fatigue after extended absences without damaging FSRS stability.
 */
export async function redistributeBacklog(
  deckId?: string,
  recoveryDays: number = 5,
  now: Date = new Date(),
  rolloverHour: number = 4
): Promise<{ redistributedCount: number; cardsPerDay: number }> {
  const currentStart = getCurrentLogicalDayStart(now, rolloverHour);
  const days = Math.max(3, Math.min(14, recoveryDays));

  // Query overdue review cards
  let query = db.cards
    .where('state')
    .equals(State.Review)
    .filter((c) => !c.deletedAt && new Date(c.due) < currentStart);

  if (deckId) {
    query = query.filter((c) => c.deckId === deckId);
  }

  const overdueCards = await query.toArray();
  if (overdueCards.length === 0) {
    return { redistributedCount: 0, cardsPerDay: 0 };
  }

  // Sort by stability ascending so least stable cards are reviewed earliest
  overdueCards.sort((a, b) => (a.stability || 0) - (b.stability || 0));

  const perDay = Math.ceil(overdueCards.length / days);

  for (let i = 0; i < overdueCards.length; i++) {
    const card = overdueCards[i];
    const dayOffset = Math.floor(i / perDay);
    const targetDate = new Date(currentStart.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    targetDate.setHours(rolloverHour, 0, 0, 0);

    card.due = targetDate.getTime();
    card.updatedAt = Date.now();
    await db.cards.put(card);
  }

  return {
    redistributedCount: overdueCards.length,
    cardsPerDay: perDay,
  };
}
