import Dexie, { type EntityTable } from 'dexie';
import { default_w } from 'ts-fsrs';
import { v4 as uuidv4 } from 'uuid';

export interface UserSettingsRecord {
  id: 'global';                // Singleton Primary Key
  algorithm: 'fsrs6' | 'sm2';  // Active scheduling engine
  fsrsWeights: number[];       // 21-parameter FSRS-6 weight array
  requestRetention: number;    // Target retention (Default: 0.90)
  dayRolloverHour: number;     // Logical study day cutoff (Default: 4 for 04:00 AM)
  learningSteps: number[];     // Default intraday learning steps in minutes: Array(1, 10)
  relearningSteps: number[];   // Default lapse relearning steps in minutes: Array(10)
  theme: 'light' | 'dark' | 'oled';

  // Phase 4 Expanded Power-User Settings
  cjkFontStyle: 'sans' | 'serif' | 'textbook';           // Default: 'sans'
  cardFontSize: 'sm' | 'md' | 'lg' | 'xl';               // Default: 'md'
  readingDisplayMode: 'tap' | 'always' | 'back_only';    // Default: 'tap'
  autoPlayAudio: 'off' | 'front' | 'back' | 'both';      // Default: 'back'
  ttsSpeed: number;                                      // Default: 0.95 (0.5 to 1.5)
  handedness: 'right' | 'left';                          // Default: 'right'
  enableHaptics: boolean;                                // Default: true
  autoScratchpad: 'off' | 'production_only' | 'always';  // Default: 'production_only'
  leechThreshold: number;                                // Default: 4
  leechAction: 'flag' | 'suspend';                       // Default: 'flag'
  backupReminderDays: number;                            // Default: 7
  lastBackupAt?: number;                                 // UTC ms of last snapshot export

  updatedAt: number;           // UTC Milliseconds for cross-device sync
}

export interface DeckRecord {
  id: string;                  // Primary Key (UUID v4)
  name: string;                // Deck Display Name
  parentId: string | null;     // Tree hierarchy pointer (null for root books)
  path: string;                // e.g., "Minna no Nihongo/Chapter 1/Vocabulary"
  book?: string;               // Top-level curriculum descriptor
  chapter?: string;            // Unit or chapter descriptor
  language: string;            // BCP-47 tag (e.g., 'ja-JP', 'zh-CN', 'ko-KR', 'en-US')
  newCardsPerDay: number;      // Default: 20
  reviewsPerDay: number;       // Default: 200
  learningSteps?: number[];    // Optional per-deck override in minutes
  relearningSteps?: number[];  // Optional per-deck override in minutes
  generateTwinCards: boolean;  // Auto-generate Meaning -> Character cards
  reviewOrder: 'dueFirst' | 'relativeOverdue' | 'random';
  updatedAt: number;           // UTC Milliseconds
  deletedAt?: number | null;   // Soft-delete tombstone for sync propagation
}

export interface NoteRecord {
  id: string;                  // Primary Key (UUID v4)
  character: string;           // Target language script (Front Side)
  meaning: string;             // Translation and definition (Back Side)
  reading?: string;            // Tap-to-reveal Furigana / Pinyin / IPA
  pitchOrTone?: string;        // Pitch accent contours or tone markers
  radicals?: string[];         // Component keys for associative lookup
  exampleSentence?: string;    // Contextual sentence
  notes?: string;              // User notes and custom mnemonics
  tags: string[];              // Cross-cutting categorization tags
  audioHash?: string;          // SHA-256 content-addressed term audio in OPFS
  sentenceAudioHash?: string;  // SHA-256 content-addressed sentence audio in OPFS
  imageHash?: string;          // SHA-256 content-addressed card image in OPFS
  updatedAt: number;           // Field-level conflict resolution timestamp
  deletedAt?: number | null;   // Soft-delete tombstone
}

export interface CardRecord {
  id: string;                  // Primary Key (UUID v4)
  noteId: string;              // Foreign Key -> NoteRecord.id (links sibling cards)
  deckId: string;              // Primary Foreign Key -> DeckRecord.id
  secondaryDeckIds?: string[]; // Additional chapter deck IDs for merged duplicate notes
  direction: 'recognition' | 'production' | 'cloze';
  clozeIndex?: number;         // Cloze deletion ordinal (1 for c1, 2 for c2, etc.)
  
  // FSRS-6 Scheduling Parameters
  due: number;                 // UTC Milliseconds scheduled for review
  stability: number;           // S: Days until recall drops to 90%
  difficulty: number;          // D: Inherent difficulty (1.0 to 10.0)
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: 0 | 1 | 2 | 3;        // 0: New, 1: Learning, 2: Review, 3: Relearning
  lastReview?: number;

  // Queue & Lifecycle Flags
  buriedUntil?: number | null; // Logical rollover timestamp for buried items
  isSuspended: boolean;
  isLeech: boolean;
  isFlagged?: 'red' | 'orange' | 'blue' | null; // 1-tap in-session bookmark flag
  updatedAt: number;           // Conflict resolution timestamp
  deletedAt?: number | null;   // Soft-delete tombstone
}

export interface ReviewLogEntry {
  id: string;                  // Primary Key (UUID v4) for event-sourced sync
  cardId: string;              // Foreign Key -> CardRecord.id
  rating: 1 | 2 | 3 | 4;       // 1: Again, 2: Hard, 3: Good, 4: Easy
  state: 0 | 1 | 2 | 3;        // Card state prior to review
  reviewTime: number;          // UTC Milliseconds
  elapsedMs: number;           // Active thinking time prior to card reveal
  scheduledDays: number;
  deviceId: string;            // Unique device identifier
  isRevoked?: boolean;         // True if undone via Instant Undo Stack
}

// Phase 4 Goal-Driven Study Plan Record
export interface StudyPlanRecord {
  id: string;                  // UUID v4
  title: string;               // e.g., "Minna no Nihongo Ch 1-10"
  targetDeckIds: string[];     // Selected Book/Chapter/Deck IDs
  startDate: number;           // UTC ms
  targetDate: number;          // Deadline / Exam UTC ms
  bufferDays: number;          // Final review-only days before targetDate (default: 7)
  activeDaysOfWeek: number[];  // e.g., [1,2,3,4,5,6] (0 = Sun, 6 = Sat)
  dailyMinutesCap: number;     // User's max daily time budget (e.g., 25)
  targetRetention: number;     // e.g., 0.90 or 0.95 for exam prep
  computedNewCardsPerDay: number;
  computedReviewsPerDay: number;
  isActive: boolean;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: UserSettingsRecord = {
  id: 'global',
  algorithm: 'fsrs6',
  fsrsWeights: Array.from(default_w),
  requestRetention: 0.90,
  dayRolloverHour: 4,
  learningSteps: [1, 10],
  relearningSteps: [10],
  theme: 'light',
  cjkFontStyle: 'sans',
  cardFontSize: 'md',
  readingDisplayMode: 'tap',
  autoPlayAudio: 'back',
  ttsSpeed: 0.95,
  handedness: 'right',
  enableHaptics: true,
  autoScratchpad: 'production_only',
  leechThreshold: 4,
  leechAction: 'flag',
  backupReminderDays: 7,
  lastBackupAt: undefined,
  updatedAt: Date.now(),
};

// Device ID generator & getter
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  let deviceId = localStorage.getItem('pocketsrs_device_id');
  if (!deviceId) {
    deviceId = uuidv4();
    localStorage.setItem('pocketsrs_device_id', deviceId);
  }
  return deviceId;
}

export class PocketSRSDatabase extends Dexie {
  settings!: EntityTable<UserSettingsRecord, 'id'>;
  decks!: EntityTable<DeckRecord, 'id'>;
  notes!: EntityTable<NoteRecord, 'id'>;
  cards!: EntityTable<CardRecord, 'id'>;
  revlog!: EntityTable<ReviewLogEntry, 'id'>;
  studyPlans!: EntityTable<StudyPlanRecord, 'id'>;

  constructor() {
    super('PocketSRSDatabase');

    // Section 6.2 Relational Database Schemas & Indices (v1)
    this.version(1).stores({
      settings: 'id',
      decks: 'id, parentId, path, book, updatedAt, deletedAt',
      notes: 'id, character, [character+reading], *tags, *radicals, updatedAt, deletedAt',
      cards: 'id, noteId, deckId, *secondaryDeckIds, [deckId+state+due], [state+due], isFlagged, updatedAt, deletedAt',
      revlog: 'id, cardId, reviewTime, deviceId',
    });

    // Phase 4: Study Plans Table (v2)
    this.version(2).stores({
      settings: 'id',
      decks: 'id, parentId, path, book, updatedAt, deletedAt',
      notes: 'id, character, [character+reading], *tags, *radicals, updatedAt, deletedAt',
      cards: 'id, noteId, deckId, *secondaryDeckIds, [deckId+state+due], [state+due], isFlagged, updatedAt, deletedAt',
      revlog: 'id, cardId, reviewTime, deviceId',
      studyPlans: 'id, isActive, targetDate, updatedAt',
    });

    this.on('populate', () => {
      this.seedDefaults();
    });
  }

  async seedDefaults() {
    const existing = await this.settings.get('global');
    if (!existing) {
      await this.settings.put(DEFAULT_SETTINGS);
    }
  }
}

export const db = new PocketSRSDatabase();

// Ensure initialization and initial seed verification
export async function initializeDatabase(): Promise<PocketSRSDatabase> {
  await db.open();
  const settings = await db.settings.get('global');
  if (!settings) {
    await db.seedDefaults();
  } else {
    // Fill in any missing Phase 4 fields on existing installations
    let hasChanges = false;
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof UserSettingsRecord)[]) {
      if (settings[key] === undefined) {
        (settings as any)[key] = DEFAULT_SETTINGS[key];
        hasChanges = true;
      }
    }
    if (hasChanges) {
      await db.settings.put(settings);
    }
  }
  return db;
}
