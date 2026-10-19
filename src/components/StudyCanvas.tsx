import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Volume2,
  Undo2,
  Flag,
  Edit3,
  Eye,
  EyeOff,
  Flame,
  Clock,
  Sparkles,
  ArrowLeft,
  Settings2,
  Check,
  RotateCcw,
  SlidersHorizontal,
  PenTool,
  PenOff,
  Image as ImageIcon,
  Sun,
  HelpCircle,
} from 'lucide-react';
import { GuideModal } from './GuideModal';
import {
  db,
  type CardRecord,
  type NoteRecord,
  type DeckRecord,
  type UserSettingsRecord,
} from '../storage/db';
import {
  reviewCard,
  undoLastReview,
  previewNextIntervals,
  buildStudyQueue,
  type StudyMode,
} from '../engine/fsrs';
import { QuickEditModal } from './QuickEditModal';
import { ScratchpadCanvas } from './ScratchpadCanvas';
import { RadicalDrawer } from './RadicalDrawer';
import { getMediaUrlFromOPFS } from '../storage/opfs';
import { useWakeLock } from '../hooks/useWakeLock';
import { mediaSessionManager } from '../audio/mediaSession';

interface StudyCanvasProps {
  deckIds: string[];
  deckName: string;
  language?: string;
  studyMode?: StudyMode;
  onExit: () => void;
}

export const StudyCanvas: React.FC<StudyCanvasProps> = ({
  deckIds,
  deckName,
  language = 'ja-JP',
  studyMode = 'standard',
  onExit,
}) => {
  // Session queue state
  const [queue, setQueue] = useState<CardRecord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showReadingOnFront, setShowReadingOnFront] = useState(false);
  const [loading, setLoading] = useState(true);

  // Active card records
  const [currentNote, setCurrentNote] = useState<NoteRecord | null>(null);
  const [currentDeck, setCurrentDeck] = useState<DeckRecord | null>(null);
  const [settings, setSettings] = useState<UserSettingsRecord | null>(null);
  const liveSettings = useLiveQuery(() => db.settings.get('global'));
  const activeSettings = liveSettings || settings;

  // Font style and size mapping from settings
  const fontStyleClass = (() => {
    switch (activeSettings?.cjkFontStyle) {
      case 'serif':
        return 'font-serif';
      case 'textbook':
        return 'font-serif tracking-wider';
      case 'sans':
      default:
        return 'font-sans';
    }
  })();

  const fontSizeClass = (() => {
    switch (activeSettings?.cardFontSize) {
      case 'sm':
        return 'text-4xl md:text-5xl';
      case 'lg':
        return 'text-6xl md:text-7xl';
      case 'xl':
        return 'text-7xl md:text-8xl';
      case 'md':
      default:
        return 'text-5xl md:text-6xl';
    }
  })();

  const readingDisplayMode = activeSettings?.readingDisplayMode || 'tap';
  const isLeftHanded = activeSettings?.handedness === 'left';

  // In-session toggles
  const [isTwoButtonMode, setIsTwoButtonMode] = useState(false);
  const [isTypeMode, setIsTypeMode] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [isQuickEditOpen, setIsQuickEditOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [selectedRadical, setSelectedRadical] = useState<string | null>(null);
  const [cardImageUrl, setCardImageUrl] = useState<string | null>(null);

  // In-session Writing Mode State (Hotkey: W, persisted to localStorage & UserSettingsRecord)
  const [isWritingModeEnabled, setIsWritingModeEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('pocketsrs_writing_mode');
      if (saved !== null) return saved === 'true';
    } catch {}
    return true;
  });

  const toggleWritingMode = useCallback(() => {
    setIsWritingModeEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('pocketsrs_writing_mode', String(next));
        db.settings.update('global', {
          autoScratchpad: next ? 'always' : 'off',
          updatedAt: Date.now(),
        }).catch(() => {});
      } catch {}
      setFeedbackToast(next ? 'Writing Mode ON' : 'Writing Mode OFF');
      return next;
    });
  }, []);

  // Timers and metrics
  const cardStartTimeRef = useRef<number>(Date.now());
  const [undoStackCount, setUndoStackCount] = useState(0);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);

  // Touch gesture tracking
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [swipeOffset, setSwipeOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Screen Wake Lock API integration (PRD §5.4)
  const { isLocked: isWakeLocked, isSupported: isWakeLockSupported } = useWakeLock(true);

  // Background Audio Keep-Alive Lifecycle (PRD §5.4)
  useEffect(() => {
    mediaSessionManager.startKeepAlive();
    return () => {
      mediaSessionManager.stopKeepAlive();
    };
  }, []);

  // Load initial settings and study queue
  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const userSettings = (await db.settings.get('global')) || null;
      setSettings(userSettings);
      try {
        const savedWritingMode = localStorage.getItem('pocketsrs_writing_mode');
        if (savedWritingMode !== null) {
          setIsWritingModeEnabled(savedWritingMode === 'true');
        } else if (userSettings) {
          setIsWritingModeEnabled(userSettings.autoScratchpad !== 'off');
        }
      } catch {}

      const built = await buildStudyQueue({
        deckIds,
        mode: studyMode,
      });

      setQueue(built.combinedQueue);
      setCurrentIndex(0);
      setIsFlipped(false);
      setShowReadingOnFront(false);
      setTypedAnswer('');
      cardStartTimeRef.current = Date.now();
    } finally {
      setLoading(false);
    }
  }, [deckIds, studyMode]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Current active card
  const currentCard = queue[currentIndex] || null;

  // Load Note and Deck for current card
  useEffect(() => {
    if (!currentCard) {
      setCurrentNote(null);
      setCurrentDeck(null);
      setCardImageUrl(null);
      return;
    }

    let isMounted = true;
    cardStartTimeRef.current = Date.now();
    setIsFlipped(false);
    setShowReadingOnFront(false);
    setTypedAnswer('');

    Promise.all([
      db.notes.get(currentCard.noteId),
      db.decks.get(currentCard.deckId),
    ]).then(async ([note, deck]) => {
      if (!isMounted) return;
      setCurrentNote(note || null);
      setCurrentDeck(deck || null);

      if (note?.imageHash) {
        const url = await getMediaUrlFromOPFS(note.imageHash);
        if (isMounted) setCardImageUrl(url);
      } else {
        setCardImageUrl(null);
      }

      if (note) {
        mediaSessionManager.updateCard({
          character: currentCard.direction === 'production' ? '?' : note.character,
          reading: currentCard.direction === 'production' ? '' : note.reading,
          meaning: note.meaning,
          deckName: deck?.name || deckName,
        });


        // Phase 4: Auto-play front audio (suppressed on production cards to prevent spoiler)
        if (
          currentCard.direction !== 'production' &&
          (settings?.autoPlayAudio === 'front' || settings?.autoPlayAudio === 'both')
        ) {
          setTimeout(() => {
            if (isMounted) playTTS();
          }, 250);
        }
      }
    });

    return () => {
      isMounted = false;
    };
  }, [currentCard, deckName, settings]);

  // Toast auto-clear
  useEffect(() => {
    if (!feedbackToast) return;
    const timer = setTimeout(() => setFeedbackToast(null), 2500);
    return () => clearTimeout(timer);
  }, [feedbackToast]);

  // TTS & OPFS Audio playback
  const playTTS = useCallback(
    async (text?: string) => {
      // If playing the main character and OPFS audio hash exists, play directly
      if (!text && currentNote?.audioHash) {
        const audioUrl = await getMediaUrlFromOPFS(currentNote.audioHash);
        if (audioUrl) {
          const audio = new Audio(audioUrl);
          audio.play().catch(() => {});
          return;
        }
      }

      const targetText = text || currentNote?.character;
      if (!targetText || !('speechSynthesis' in window)) return;

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(targetText);
      const bcp47 = currentDeck?.language || language || 'ja-JP';
      utterance.lang = bcp47;
      utterance.rate = settings?.ttsSpeed ?? 0.95;

      const voices = window.speechSynthesis.getVoices();
      const match = voices.find((v) =>
        v.lang.toLowerCase().replace('_', '-').startsWith(bcp47.toLowerCase().slice(0, 2))
      );
      if (match) utterance.voice = match;

      window.speechSynthesis.speak(utterance);
    },
    [currentNote, currentDeck, language, settings?.ttsSpeed]
  );

  // Previews of intervals for 4 rating buttons
  const intervals = React.useMemo(() => {
    if (!currentCard || !settings) return null;
    return previewNextIntervals(currentCard, settings, currentDeck || undefined);
  }, [currentCard, settings, currentDeck]);

  // Flip card
  const handleFlip = useCallback(() => {
    if (!isFlipped) {
      setIsFlipped(true);
      if (currentNote) {
        mediaSessionManager.updateCard({
          character: currentNote.character,
          reading: currentNote.reading,
          meaning: currentNote.meaning,
          deckName: currentDeck?.name || deckName,
        });
      }
      // Auto-play TTS on flip if enabled
      if (settings?.autoPlayAudio === 'back' || settings?.autoPlayAudio === 'both') {
        playTTS();
      }
    }
  }, [isFlipped, playTTS, settings?.autoPlayAudio, currentNote, currentDeck, deckName]);

  // Execute review rating
  const handleRate = useCallback(
    async (rating: 1 | 2 | 3 | 4) => {
      if (!currentCard || !currentNote) return;

      // Phase 4: Haptic Feedback
      if (settings?.enableHaptics && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(15);
        } catch {}
      }

      const elapsedMs = Math.max(500, Date.now() - cardStartTimeRef.current);
      await reviewCard(currentCard, rating, elapsedMs, new Date(), studyMode === 'cram');

      setUndoStackCount((prev) => prev + 1);

      // If rating is Again (1), re-append card to the queue for intraday review
      if (rating === 1) {
        setQueue((prevQueue) => {
          const nextQueue = [...prevQueue];
          // Re-insert at an offset or at the end of the session
          nextQueue.push(currentCard);
          return nextQueue;
        });
      }

      // Advance to next card
      setCurrentIndex((prev) => prev + 1);
      setIsFlipped(false);
      setShowReadingOnFront(false);
      setTypedAnswer('');
      cardStartTimeRef.current = Date.now();
    },
    [currentCard, currentNote, studyMode]
  );

  // Instant Undo (Hotkey: Z / Ctrl+Z)
  const handleUndo = useCallback(async () => {
    const { restoredCard, revokedLog } = await undoLastReview();
    if (!restoredCard || !revokedLog) {
      setFeedbackToast('Nothing to undo');
      return;
    }

    setFeedbackToast('Undone previous review');
    setUndoStackCount((prev) => Math.max(0, prev - 1));

    // Put restored card right back in the queue at current position
    setQueue((prevQueue) => {
      const updated = [...prevQueue];
      const prevIdx = Math.max(0, currentIndex - 1);
      updated[prevIdx] = restoredCard;
      return updated;
    });

    setCurrentIndex((prev) => Math.max(0, prev - 1));
    setIsFlipped(false);
    setShowReadingOnFront(false);
    setTypedAnswer('');
    cardStartTimeRef.current = Date.now();
  }, [currentIndex]);

  // 1-Tap Flag (Hotkey: F)
  const handleCycleFlag = useCallback(async () => {
    if (!currentCard) return;
    const flags: (CardRecord['isFlagged'])[] = [null, 'red', 'orange', 'blue'];
    const currentIdx = flags.indexOf(currentCard.isFlagged || null);
    const nextFlag = flags[(currentIdx + 1) % flags.length];

    await db.cards.update(currentCard.id, {
      isFlagged: nextFlag,
      updatedAt: Date.now(),
    });

    currentCard.isFlagged = nextFlag;
    setQueue((prev) => [...prev]);

    const label = nextFlag ? `Flagged ${nextFlag.toUpperCase()}` : 'Flag cleared';
    setFeedbackToast(label);
  }, [currentCard]);

  // Bury card until tomorrow (Hotkey: B)
  const handleBury = useCallback(async () => {
    if (!currentCard) return;
    const tomorrow = Date.now() + 86400000;
    await db.cards.update(currentCard.id, {
      buriedUntil: tomorrow,
      updatedAt: Date.now(),
    });
    setFeedbackToast('Card buried until tomorrow');
    setCurrentIndex((prev) => prev + 1);
    setIsFlipped(false);
  }, [currentCard]);

  // Suspend card (Hotkey: @ or S)
  const handleSuspend = useCallback(async () => {
    if (!currentCard) return;
    await db.cards.update(currentCard.id, {
      isSuspended: true,
      updatedAt: Date.now(),
    });
    setFeedbackToast('Card suspended indefinitely');
    setCurrentIndex((prev) => prev + 1);
    setIsFlipped(false);
  }, [currentCard]);

  // Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isQuickEditOpen) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Enter' && !isFlipped) {
          e.preventDefault();
          handleFlip();
        }
        return;
      }

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!isFlipped) {
          handleFlip();
        } else {
          // If already flipped, spacebar defaults to 'Good'
          handleRate(3);
        }
      } else if (e.key === '1' && isFlipped) {
        handleRate(1);
      } else if (e.key === '2' && isFlipped && !isTwoButtonMode) {
        handleRate(2);
      } else if (e.key === '3' && isFlipped) {
        handleRate(3);
      } else if (e.key === '4' && isFlipped && !isTwoButtonMode) {
        handleRate(4);
      } else if (e.key.toLowerCase() === 'f') {
        handleCycleFlag();
      } else if (e.key.toLowerCase() === 'e') {
        setIsQuickEditOpen(true);
      } else if (e.key.toLowerCase() === 'z' || (e.ctrlKey && e.key.toLowerCase() === 'z')) {
        handleUndo();
      } else if (e.key.toLowerCase() === 'b') {
        handleBury();
      } else if (e.key.toLowerCase() === 's' || e.key === '@') {
        handleSuspend();
      } else if (e.key.toLowerCase() === 'r') {
        if (isFlipped || currentCard?.direction !== 'production') {
          playTTS();
        }
      } else if (e.key.toLowerCase() === 'w') {
        e.preventDefault();
        toggleWritingMode();
      } else if (e.key === '?') {
        setIsGuideOpen(true);
      } else if (e.key === 'Escape') {
        onExit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isFlipped,
    isTwoButtonMode,
    isQuickEditOpen,
    handleFlip,
    handleRate,
    handleCycleFlag,
    handleUndo,
    handleBury,
    handleSuspend,
    playTTS,
    currentCard,
    toggleWritingMode,
    onExit,
  ]);

  // Touch Swipe Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    touchOffsetRef.current = { x: 0, y: 0 };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    touchOffsetRef.current = { x: dx, y: dy };
    setSwipeOffset({ x: dx, y: dy });
  };

  const handleTouchEnd = () => {
    if (!touchStartRef.current) return;
    const { x, y } = touchOffsetRef.current;
    const absX = Math.abs(x);
    const absY = Math.abs(y);

    if (absX > 60 || absY > 60) {
      if (!isFlipped) {
        // Any significant swipe up flips the card
        if (y < -40) handleFlip();
      } else {
        if (absX > absY) {
          // Horizontal swipes: Left = Again (1), Right = Good (3)
          if (x < -60) handleRate(1);
          else if (x > 60) handleRate(3);
        } else {
          // Vertical swipes: Down = Hard (2), Up = Easy (4)
          if (y > 60) handleRate(2);
          else if (y < -60) handleRate(4);
        }
      }
    }

    touchStartRef.current = null;
    touchOffsetRef.current = { x: 0, y: 0 };
    setSwipeOffset({ x: 0, y: 0 });
  };

  // Type-in-the-Answer Diff Renderer
  const renderAnswerDiff = () => {
    if (!isTypeMode || !isFlipped || !currentNote) return null;

    const expected = (currentNote.reading || currentNote.character || '').trim();
    const actual = typedAnswer.trim();

    return (
      <div className="w-full mt-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 text-left">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Typed Answer Comparison:
        </div>
        <div className="flex flex-col gap-1.5 font-mono text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-16">Expected:</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">{expected}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-16">You typed:</span>
            <span>
              {actual.split('').map((char, idx) => {
                const isCorrect = expected[idx] === char;
                return (
                  <span
                    key={idx}
                    className={
                      isCorrect
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'text-rose-600 dark:text-rose-400 line-through bg-rose-50 dark:bg-rose-950 px-0.5 rounded'
                    }
                  >
                    {char}
                  </span>
                );
              })}
              {actual.length < expected.length && (
                <span className="text-gray-400 text-xs italic ml-1">
                  ({expected.length - actual.length} missing characters)
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-sm text-gray-500">Preparing FSRS Study Queue...</p>
      </div>
    );
  }

  // Session Completed Screen
  if (!currentCard || !currentNote) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[500px] p-6 text-center animate-fadeIn">
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 rounded-3xl flex items-center justify-center shadow-lg shadow-emerald-500/20 mb-6">
          <Check className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Session Completed!
        </h2>
        <p className="text-gray-600 dark:text-gray-400 max-w-sm mb-6 text-sm">
          Great job! All due cards in <span className="font-semibold text-gray-900 dark:text-gray-100">{deckName}</span> have been completed for this logical day.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {undoStackCount > 0 && (
            <button
              onClick={handleUndo}
              className="px-5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium flex items-center gap-2 transition-all"
            >
              <Undo2 className="w-4 h-4" />
              Undo Last Review
            </button>
          )}
          <button
            onClick={onExit}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-md shadow-indigo-500/20 flex items-center gap-2 transition-all"
          >
            Return to Deck Tree
          </button>
        </div>
      </div>
    );
  }

  const remainingCount = queue.length - currentIndex;

  return (
    <div className="flex flex-col h-full max-h-screen max-h-[100dvh] flex-1 bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 select-none overflow-hidden">
      {/* Toast Feedback */}
      {feedbackToast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-semibold shadow-xl animate-bounce">
          {feedbackToast}
        </div>
      )}

      {/* Header Bar */}
      <div className="px-4 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onExit}
            className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
            title="Exit Session (Esc)"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium truncate max-w-[200px] md:max-w-xs">
                {deckName}
              </span>
              {studyMode === 'cram' && (
                <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 text-[10px] font-bold tracking-wide uppercase border border-amber-300 dark:border-amber-800">
                  Cram Mode (Non-Destructive)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className="text-indigo-600 dark:text-indigo-400">
                {currentIndex + 1} / {queue.length}
              </span>
              <span className="text-gray-400">•</span>
              <span className="text-gray-500">{remainingCount} left</span>
            </div>
          </div>
        </div>

        {/* Quick Toolbar */}
        <div className="flex items-center gap-1.5">
          {/* Wake Lock Status Badge */}
          {isWakeLockSupported && (
            <div
              className={`p-1.5 rounded-lg border flex items-center gap-1 text-xs transition-all ${
                isWakeLocked
                  ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-300'
                  : 'border-gray-300 dark:border-gray-700 text-gray-400'
              }`}
              title={
                isWakeLocked
                  ? 'Screen Wake Lock Active (Screen illumination maintained)'
                  : 'Screen Wake Lock Inactive'
              }
            >
              <Sun className="w-4 h-4" />
            </div>
          )}

          {/* Dedicated Writing Mode Toggle (Hotkey: W) */}
          <button
            onClick={toggleWritingMode}
            className={`px-2.5 py-1 text-xs rounded-xl border flex items-center gap-1.5 transition-all ${
              isWritingModeEnabled
                ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-500/20 font-semibold'
                : 'border-gray-300 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            title="Toggle Writing Mode (W)"
          >
            {isWritingModeEnabled ? (
              <>
                <PenTool className="w-3.5 h-3.5" />
                <span className="font-medium text-[11px] hidden sm:inline">Writing ON</span>
              </>
            ) : (
              <>
                <PenOff className="w-3.5 h-3.5" />
                <span className="font-medium text-[11px] hidden sm:inline">Writing OFF</span>
              </>
            )}
          </button>

          {/* Mode Toggles */}
          <button
            onClick={() => setIsTwoButtonMode((prev) => !prev)}
            className={`px-2.5 py-1 text-xs rounded-lg border transition-all ${
              isTwoButtonMode
                ? 'bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-950 dark:border-indigo-800 dark:text-indigo-300'
                : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            title="Toggle between 4-Button FSRS & 2-Button Pass/Fail modes"
          >
            {isTwoButtonMode ? '2-Button' : '4-Button'}
          </button>

          <button
            onClick={() => setIsTypeMode((prev) => !prev)}
            className={`px-2.5 py-1 text-xs rounded-lg border transition-all ${
              isTypeMode
                ? 'bg-purple-50 border-purple-300 text-purple-700 dark:bg-purple-950 dark:border-purple-800 dark:text-purple-300'
                : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            title="Type-in-the-Answer Mode"
          >
            Type Mode
          </button>

          {/* Flag Button (Hotkey: F) */}
          <button
            onClick={handleCycleFlag}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Color Flag (Hotkey: F)"
          >
            {currentCard.isFlagged === 'red' && <span className="text-red-500 font-bold">🚩</span>}
            {currentCard.isFlagged === 'orange' && <span className="text-orange-500 font-bold">🚩</span>}
            {currentCard.isFlagged === 'blue' && <span className="text-blue-500 font-bold">🚩</span>}
            {!currentCard.isFlagged && <Flag className="w-4 h-4 text-gray-400 hover:text-gray-600" />}
          </button>

          {/* Quick Edit (Hotkey: E) */}
          <button
            onClick={() => setIsQuickEditOpen(true)}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
            title="Quick Edit Note (Hotkey: E)"
          >
            <Edit3 className="w-4 h-4" />
          </button>

          {/* Instant Undo (Hotkey: Z) */}
          <button
            onClick={handleUndo}
            disabled={undoStackCount === 0}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 disabled:opacity-30 transition-colors"
            title="Instant Undo (Hotkey: Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>

          {/* Guide (Hotkey: ?) */}
          <button
            onClick={() => setIsGuideOpen(true)}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
            title="Knowledge Base & Guide (?)"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-gray-200 dark:bg-gray-800 h-1 shrink-0">
        <div
          className="bg-indigo-600 h-1 transition-all duration-300"
          style={{ width: `${((currentIndex) / queue.length) * 100}%` }}
        ></div>
      </div>

      {/* Leech Alert Banner */}
      {currentCard.isLeech && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 font-medium">
            <Flame className="w-4 h-4 text-amber-500" />
            <span>Leech Card: You have lapsed on this item 4+ times.</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsQuickEditOpen(true)}
              className="underline font-semibold hover:text-amber-800"
            >
              Add Mnemonic (E)
            </button>
            <button
              onClick={handleSuspend}
              className="underline font-semibold hover:text-amber-800"
            >
              Suspend (S)
            </button>
          </div>
        </div>
      )}

      {/* Main Flashcard Container */}
      <div
        className={`flex-1 overflow-y-auto p-4 md:p-6 flex flex-col items-center ${
          isWritingModeEnabled ? 'justify-start' : 'justify-center'
        } min-h-0 cursor-pointer`}
        onClick={() => {
          if (!isWritingModeEnabled) handleFlip();
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: `translate(${swipeOffset.x * 0.3}px, ${swipeOffset.y * 0.3}px)`,
          transition: swipeOffset.x === 0 ? 'transform 0.2s ease-out' : 'none',
        }}
      >
        <div
          className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-3xl shadow-xl border border-gray-200 dark:border-gray-800 p-6 md:p-10 flex flex-col items-center text-center relative transition-all"
          onClick={(e) => {
            // Prevent input click from flipping
            if (e.target instanceof HTMLInputElement) e.stopPropagation();
          }}
        >
          {/* Card Direction Badge */}
          <div className="absolute top-4 left-5 flex items-center gap-2 text-[11px] font-semibold text-gray-400 tracking-wider uppercase">
            {currentCard.direction === 'production' ? (
              <span className="px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400">
                Meaning → Character
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
                Character → Meaning
              </span>
            )}
            {currentCard.state === 0 && <span className="text-blue-500 font-bold">NEW</span>}
            {currentCard.state === 1 && <span className="text-amber-500 font-bold">LEARNING</span>}
          </div>

          {/* Audio TTS Button (hidden on front of production cards to prevent spoiler) */}
          {(isFlipped || currentCard.direction !== 'production') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                playTTS();
              }}
              className="absolute top-4 right-5 p-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-950 text-gray-600 dark:text-gray-300 hover:text-indigo-600 transition-colors"
              title="Play Audio (R)"
            >
              <Volume2 className="w-5 h-5" />
            </button>
          )}

          {/* FRONT SIDE (Character / Target Script) */}
          <div className="mt-8 mb-6 flex flex-col items-center">
            {currentCard.direction === 'production' ? (
              <div className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100">
                {currentNote.meaning}
              </div>
            ) : (
              <>
                {/* Large high-legibility character display */}
                <div className={`${fontSizeClass} ${fontStyleClass} font-bold tracking-tight text-gray-900 dark:text-gray-100 my-2`}>
                  {currentNote.character}
                </div>

                {/* Reading display based on readingDisplayMode */}
                {currentNote.reading && (readingDisplayMode === 'always' ? (
                  <div className="mt-2 px-3 py-1 rounded-full text-sm font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50">
                    {currentNote.reading}
                  </div>
                ) : readingDisplayMode === 'tap' ? (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowReadingOnFront((prev) => !prev);
                    }}
                    className="mt-2 px-3 py-1 rounded-full text-sm font-medium transition-colors cursor-pointer bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-1.5"
                  >
                    {showReadingOnFront ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5 text-gray-500" />
                        <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                          {currentNote.reading}
                        </span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-gray-500 dark:text-gray-400 text-xs">
                          Tap to reveal reading
                        </span>
                      </>
                    )}
                  </div>
                ) : null /* 'back_only' hides reading completely on front */ )}

                {/* Pitch / Tone indicator if available */}
                {currentNote.pitchOrTone && (
                  <div className="mt-2 text-xs text-gray-400 font-mono">
                    {currentNote.pitchOrTone}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Type-in-the-Answer Input (if enabled) */}
          {isTypeMode && !isFlipped && (
            <div className="w-full max-w-sm my-3" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                autoFocus
                value={typedAnswer}
                onChange={(e) => setTypedAnswer(e.target.value)}
                placeholder="Type reading or answer..."
                className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-center font-medium outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-gray-900 transition-all"
              />
            </div>
          )}

          {/* Reveal Cue when not flipped */}
          {!isFlipped && (
            <div className="mt-6 text-xs text-gray-400 flex items-center gap-1">
              <span>{isWritingModeEnabled ? 'Use "Show Answer" button below to reveal' : 'Press Spacebar or Tap card to reveal'}</span>
            </div>
          )}

          {/* BACK SIDE (Revealed details) */}
          {isFlipped && (
            <div className="w-full pt-6 border-t border-gray-100 dark:border-gray-800 space-y-4 animate-fadeIn">
              {/* Target Character Anchor with full reading */}
              {currentCard.direction === 'production' ? (
                <div className="space-y-1">
                  <div className={`${fontSizeClass} ${fontStyleClass} font-bold text-gray-900 dark:text-gray-100`}>
                    {currentNote.character}
                  </div>
                  {currentNote.reading && (
                    <div className="text-base text-indigo-600 dark:text-indigo-400 font-medium">
                      {currentNote.reading}
                    </div>
                  )}
                  {currentNote.pitchOrTone && (
                    <div className="text-xs text-gray-400 font-mono">
                      {currentNote.pitchOrTone}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    {currentNote.meaning}
                  </div>
                </div>
              )}

              {/* OPFS Card Image if present */}
              {cardImageUrl && (
                <div className="my-3 max-h-48 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 flex items-center justify-center bg-gray-50 dark:bg-gray-800/50">
                  <img src={cardImageUrl} alt="Card asset" className="max-h-48 object-contain" />
                </div>
              )}

              {/* Type Mode Diff Output */}
              {renderAnswerDiff()}

              {/* Radical / Component Badges with Interactive Drawer Click */}
              {currentNote.radicals && currentNote.radicals.length > 0 && (
                <div className="flex flex-wrap items-center justify-center gap-1.5 pt-2">
                  <span className="text-xs text-gray-400 mr-1">Components (Tap to explore):</span>
                  {currentNote.radicals.map((rad, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRadical(rad);
                      }}
                      className="px-2.5 py-1 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 font-semibold text-xs border border-indigo-200/50 dark:border-indigo-800/50 transition-all hover:scale-105"
                      title={`Explore other cards with radical ${rad}`}
                    >
                      {rad}
                    </button>
                  ))}
                </div>
              )}

              {/* Contextual Example Sentence */}
              {currentNote.exampleSentence && (
                <div className="p-3.5 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 text-left relative group">
                  <div className="text-xs font-semibold text-gray-400 mb-1 flex items-center justify-between">
                    <span>Example:</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        playTTS(currentNote.exampleSentence);
                      }}
                      className="text-gray-400 hover:text-indigo-600 transition-colors p-1"
                      title="Play Sentence Audio"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed font-sans">
                    {currentNote.exampleSentence}
                  </div>
                </div>
              )}

              {/* User Notes & Mnemonics */}
              {currentNote.notes && (
                <div className="text-xs text-gray-500 dark:text-gray-400 italic text-left px-2">
                  <span className="font-semibold not-italic">Notes:</span> {currentNote.notes}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Scratchpad Canvas Drawer (Tablet / Mobile Stylus with Palm Rejection) */}
        {isWritingModeEnabled && (
          <div className="w-full max-w-xl mx-auto mt-4 animate-fadeIn" onClick={(e) => e.stopPropagation()}>
            <ScratchpadCanvas
              isOpen={isWritingModeEnabled}
              ghostCharacter={currentNote.character}
              onClose={() => toggleWritingMode()}
              hideGhostGuide={currentCard.direction === 'production' && !isFlipped}
            />
          </div>
        )}
      </div>

      {/* Interactive Radical Component Explorer Drawer */}
      <RadicalDrawer
        radical={selectedRadical}
        isOpen={Boolean(selectedRadical)}
        onClose={() => setSelectedRadical(null)}
      />

      {/* RATING BUTTONS DOCK (Fixed Sticky Footer) */}
      <div
        className="sticky bottom-0 w-full z-10 bg-white dark:bg-zinc-900 border-t border-gray-200 dark:border-gray-800 py-3 px-4 shadow-lg shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="max-w-xl mx-auto">
          {!isFlipped ? (
            <button
              onClick={handleFlip}
              className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] text-white font-semibold text-base shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2"
            >
              <span>Show Answer</span>
              <span className="text-xs opacity-75 font-normal">(Spacebar)</span>
            </button>
          ) : isTwoButtonMode ? (
            /* 2-Button Simplified Mode */
            <div className={`grid grid-cols-2 gap-3 ${isLeftHanded ? '[direction:rtl] [&>*]:[direction:ltr]' : ''}`}>
              <button
                onClick={() => handleRate(1)}
                className="py-3.5 px-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/60 active:scale-95 transition-all flex flex-col items-center"
              >
                <span className="text-rose-700 dark:text-rose-300 font-bold text-base">
                  Forgot
                </span>
                <span className="text-[11px] text-rose-500 dark:text-rose-400">
                  {intervals?.[1]?.intervalText || '< 1m'} (1)
                </span>
              </button>

              <button
                onClick={() => handleRate(3)}
                className="py-3.5 px-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 active:scale-95 transition-all flex flex-col items-center"
              >
                <span className="text-emerald-700 dark:text-emerald-300 font-bold text-base">
                  Remembered
                </span>
                <span className="text-[11px] text-emerald-500 dark:text-emerald-400">
                  {intervals?.[3]?.intervalText || '1d'} (3)
                </span>
              </button>
            </div>
          ) : (
            /* 4-Button Standard FSRS Mode */
            <div className={`grid grid-cols-4 gap-2 ${isLeftHanded ? '[direction:rtl] [&>*]:[direction:ltr]' : ''}`}>
              {/* Again (1) */}
              <button
                onClick={() => handleRate(1)}
                className="py-3 px-2 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 hover:bg-rose-100 dark:hover:bg-rose-900/60 active:scale-95 transition-all flex flex-col items-center"
              >
                <span className="text-rose-700 dark:text-rose-300 font-bold text-sm">
                  Again
                </span>
                <span className="text-[10px] text-rose-500 dark:text-rose-400">
                  {intervals?.[1]?.intervalText || '< 1m'}
                </span>
                <span className="text-[9px] text-gray-400 mt-0.5">1</span>
              </button>

              {/* Hard (2) */}
              <button
                onClick={() => handleRate(2)}
                className="py-3 px-2 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 hover:bg-amber-100 dark:hover:bg-amber-900/60 active:scale-95 transition-all flex flex-col items-center"
              >
                <span className="text-amber-700 dark:text-amber-300 font-bold text-sm">
                  Hard
                </span>
                <span className="text-[10px] text-amber-500 dark:text-amber-400">
                  {intervals?.[2]?.intervalText || '10m'}
                </span>
                <span className="text-[9px] text-gray-400 mt-0.5">2</span>
              </button>

              {/* Good (3) */}
              <button
                onClick={() => handleRate(3)}
                className="py-3 px-2 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 active:scale-95 transition-all flex flex-col items-center"
              >
                <span className="text-emerald-700 dark:text-emerald-300 font-bold text-sm">
                  Good
                </span>
                <span className="text-[10px] text-emerald-500 dark:text-emerald-400">
                  {intervals?.[3]?.intervalText || '1d'}
                </span>
                <span className="text-[9px] text-gray-400 mt-0.5">3</span>
              </button>

              {/* Easy (4) */}
              <button
                onClick={() => handleRate(4)}
                className="py-3 px-2 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 active:scale-95 transition-all flex flex-col items-center"
              >
                <span className="text-blue-700 dark:text-blue-300 font-bold text-sm">
                  Easy
                </span>
                <span className="text-[10px] text-blue-500 dark:text-blue-400">
                  {intervals?.[4]?.intervalText || '4d'}
                </span>
                <span className="text-[9px] text-gray-400 mt-0.5">4</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Quick Edit Modal */}
      <QuickEditModal
        noteId={currentCard.noteId}
        isOpen={isQuickEditOpen}
        onClose={() => setIsQuickEditOpen(false)}
        language={currentDeck?.language || language}
        onSaved={(updated) => setCurrentNote(updated)}
      />

      {/* In-App Guide Modal */}
      <GuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
      />
    </div>
  );
};
