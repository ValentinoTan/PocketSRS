import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  FolderPlus,
  Plus,
  Play,
  Zap,
  Flame,
  ChevronRight,
  ChevronDown,
  BookOpen,
  Folder,
  Layers,
  Upload,
  Download,
  Trash2,
  Search,
  Settings,
  MoreVertical,
  CheckCircle2,
  Sparkles,
  Wifi,
  Target,
  HelpCircle,
  FileSpreadsheet,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { db, type DeckRecord, type CardRecord } from '../storage/db';
import { isCardDue, isCardBuried } from '../engine/rollover';
import { getDescendantDeckIds, exportDeckToCSV, exportDeckToTSV, exportDeckToMarkdown } from '../importers/textParser';
import { type StudyMode, generateTwinCardsForDeck } from '../engine/fsrs';
import { ImportModal } from './ImportModal';
import { StudyPlanBanner } from './StudyPlanner';

interface DeckTreeProps {
  onStartStudy: (deckIds: string[], deckName: string, mode: StudyMode, language: string) => void;
  onOpenCardBrowser: () => void;
  onOpenSettings: () => void;
  onOpenSync: () => void;
  onOpenGuide: () => void;
  onOpenPlanner: () => void;
}

interface DeckNode {
  deck: DeckRecord;
  children: DeckNode[];
  counts: {
    newCount: number;
    learningCount: number;
    reviewCount: number;
    totalDue: number;
  };
  cumulativeCounts: {
    newCount: number;
    learningCount: number;
    reviewCount: number;
    totalDue: number;
  };
}

export const DeckTree: React.FC<DeckTreeProps> = ({
  onStartStudy,
  onOpenCardBrowser,
  onOpenSettings,
  onOpenSync,
  onOpenGuide,
  onOpenPlanner,
}) => {
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [importTargetDeck, setImportTargetDeck] = useState<DeckRecord | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [selectedNodeForAction, setSelectedNodeForAction] = useState<string | null>(null);
  const [isCreatingDeck, setIsCreatingDeck] = useState<{ parentId: string | null; type: 'book' | 'chapter' | 'deck' } | null>(null);
  const [newDeckName, setNewDeckName] = useState('');
  const [newDeckLang, setNewDeckLang] = useState('ja-JP');


  // Live queries
  const decks = useLiveQuery(() => db.decks.filter((d) => !d.deletedAt || d.deletedAt === 0).toArray(), []);
  const cards = useLiveQuery(() => db.cards.filter((c) => !c.deletedAt || c.deletedAt === 0).toArray(), []);

  // Compute card counts per deck
  const deckCardsMap = useMemo(() => {
    const map = new Map<string, { newCount: number; learningCount: number; reviewCount: number }>();
    if (!cards) return map;

    const now = new Date();

    for (const card of cards) {
      if (card.isSuspended || isCardBuried(card, now)) continue;

      const deckIds = [card.deckId, ...(card.secondaryDeckIds || [])];
      for (const dId of deckIds) {
        if (!map.has(dId)) {
          map.set(dId, { newCount: 0, learningCount: 0, reviewCount: 0 });
        }
        const counts = map.get(dId)!;
        if (card.state === 0) {
          counts.newCount++;
        } else if (card.state === 1 || card.state === 3) {
          counts.learningCount++;
        } else if (card.state === 2 && isCardDue(card, now)) {
          counts.reviewCount++;
        }
      }
    }

    return map;
  }, [cards]);

  // Build recursive tree structure
  const deckTree = useMemo(() => {
    if (!decks) return [];

    const deckMap = new Map<string, DeckRecord>();
    for (const d of decks) {
      deckMap.set(d.id, d);
    }

    const buildNode = (deck: DeckRecord): DeckNode => {
      const childrenDecks = decks.filter((d) => d.parentId === deck.id);
      const childrenNodes = childrenDecks.map(buildNode);

      const localCounts = deckCardsMap.get(deck.id) || { newCount: 0, learningCount: 0, reviewCount: 0 };
      const counts = {
        ...localCounts,
        totalDue: localCounts.newCount + localCounts.learningCount + localCounts.reviewCount,
      };

      const cumulativeCounts = { ...counts };
      for (const child of childrenNodes) {
        cumulativeCounts.newCount += child.cumulativeCounts.newCount;
        cumulativeCounts.learningCount += child.cumulativeCounts.learningCount;
        cumulativeCounts.reviewCount += child.cumulativeCounts.reviewCount;
        cumulativeCounts.totalDue += child.cumulativeCounts.totalDue;
      }

      return {
        deck,
        children: childrenNodes,
        counts,
        cumulativeCounts,
      };
    };

    // Root nodes (parentId is null)
    const roots = decks.filter((d) => !d.parentId);
    return roots.map(buildNode);
  }, [decks, deckCardsMap]);

  // Toggle node expansion
  const toggleExpand = (id: string) => {
    setExpandedNodes((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Seed sample Minna no Nihongo data if empty
  const handleSeedSample = async () => {
    const bookId = uuidv4();
    const chapterId = uuidv4();
    const deckId = uuidv4();
    const now = Date.now();

    const bookRecord: DeckRecord = {
      id: bookId,
      name: 'Minna no Nihongo (みんなの日本語)',
      parentId: null,
      path: 'Minna no Nihongo',
      book: 'Minna no Nihongo',
      language: 'ja-JP',
      newCardsPerDay: 20,
      reviewsPerDay: 200,
      generateTwinCards: true,
      reviewOrder: 'dueFirst',
      updatedAt: now,
    };

    const chapterRecord: DeckRecord = {
      id: chapterId,
      name: 'Chapter 1 (第1課)',
      parentId: bookId,
      path: 'Minna no Nihongo/Chapter 1',
      book: 'Minna no Nihongo',
      chapter: 'Chapter 1',
      language: 'ja-JP',
      newCardsPerDay: 20,
      reviewsPerDay: 200,
      generateTwinCards: true,
      reviewOrder: 'dueFirst',
      updatedAt: now,
    };

    const deckRecord: DeckRecord = {
      id: deckId,
      name: 'Vocabulary (単語)',
      parentId: chapterId,
      path: 'Minna no Nihongo/Chapter 1/Vocabulary',
      book: 'Minna no Nihongo',
      chapter: 'Chapter 1',
      language: 'ja-JP',
      newCardsPerDay: 20,
      reviewsPerDay: 200,
      generateTwinCards: true,
      reviewOrder: 'dueFirst',
      updatedAt: now,
    };

    await db.decks.bulkPut([bookRecord, chapterRecord, deckRecord]);

    // Sample notes
    const sampleNotes = [
      {
        char: '私',
        read: 'わたし',
        mean: 'I; me',
        sentence: '私はマイク・ミラーです。',
        notes: 'Pronoun',
        rads: ['禾', '厶'],
        tags: ['pronoun', 'lesson-1'],
      },
      {
        char: '学生',
        read: 'がくせい',
        mean: 'Student',
        sentence: 'サントスさんは学生じゃありません。',
        notes: 'Noun',
        rads: ['子', '生'],
        tags: ['noun', 'lesson-1'],
      },
      {
        char: '先生',
        read: 'せんせい',
        mean: 'Teacher; Instructor',
        sentence: 'ワット先生は英語の先生です。',
        notes: 'Noun / Honorific',
        rads: ['先', '生'],
        tags: ['noun', 'lesson-1'],
      },
      {
        char: '本',
        read: 'ほん',
        mean: 'Book',
        sentence: 'これは日本語の本です。',
        notes: 'Noun',
        rads: ['木'],
        tags: ['noun', 'lesson-1'],
      },
      {
        char: '食べる',
        read: 'たべる',
        mean: 'To eat',
        sentence: '毎日りんごを食べます。',
        notes: 'Transitive verb (Ichidan)',
        rads: ['食'],
        tags: ['verb', 'lesson-1'],
      },
    ];

    for (const item of sampleNotes) {
      const noteId = uuidv4();
      await db.notes.put({
        id: noteId,
        character: item.char,
        reading: item.read,
        meaning: item.mean,
        exampleSentence: item.sentence,
        notes: item.notes,
        radicals: item.rads,
        tags: item.tags,
        updatedAt: now,
      });

      // Recognition card
      await db.cards.put({
        id: uuidv4(),
        noteId,
        deckId,
        direction: 'recognition',
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
      });

      // Twin production card
      await db.cards.put({
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
      });
    }

    setExpandedNodes({ [bookId]: true, [chapterId]: true });
  };

  // Create new Book / Chapter / Deck
  const handleSaveNewDeck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeckName.trim() || !isCreatingDeck) return;

    const newId = uuidv4();
    const parentId = isCreatingDeck.parentId;
    const parentDeck = parentId ? await db.decks.get(parentId) : null;

    let path = newDeckName.trim();
    let bookName = parentDeck?.book;
    let chapterName = parentDeck?.chapter;

    if (parentDeck) {
      path = `${parentDeck.path}/${newDeckName.trim()}`;
      if (!bookName) bookName = parentDeck.name;
      else if (!chapterName) chapterName = parentDeck.name;
    } else {
      bookName = newDeckName.trim();
    }

    const newDeckRecord: DeckRecord = {
      id: newId,
      name: newDeckName.trim(),
      parentId,
      path,
      book: bookName,
      chapter: chapterName,
      language: parentDeck?.language || newDeckLang,
      newCardsPerDay: 20,
      reviewsPerDay: 200,
      generateTwinCards: true,
      reviewOrder: 'dueFirst',
      updatedAt: Date.now(),
    };

    await db.decks.put(newDeckRecord);
    if (parentId) {
      setExpandedNodes((prev) => ({ ...prev, [parentId]: true }));
    }

    setIsCreatingDeck(null);
    setNewDeckName('');
  };

  // Delete Deck
  const handleDeleteDeck = async (deckId: string) => {
    if (confirm('Delete this deck and all descendant chapters/cards?')) {
      const allDescendants = await getDescendantDeckIds(deckId);
      const now = Date.now();
      for (const dId of allDescendants) {
        await db.decks.update(dId, { deletedAt: now });
        const cardsToSoftDelete = await db.cards.where('deckId').equals(dId).toArray();
        for (const c of cardsToSoftDelete) {
          await db.cards.update(c.id, { deletedAt: now });
        }
      }
    }
  };

  // Export handlers
  const handleExport = async (deckId: string, deckName: string, format: 'csv' | 'tsv' | 'markdown') => {
    let content = '';
    let ext = '';
    let mime = '';

    if (format === 'csv') {
      content = await exportDeckToCSV(deckId, true);
      ext = 'csv';
      mime = 'text/csv;charset=utf-8;';
    } else if (format === 'tsv') {
      content = await exportDeckToTSV(deckId, true);
      ext = 'tsv';
      mime = 'text/tab-separated-values;charset=utf-8;';
    } else {
      content = await exportDeckToMarkdown(deckId, true);
      ext = 'md';
      mime = 'text/markdown;charset=utf-8;';
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${deckName.replace(/\s+/g, '_')}_export.${ext}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Launch study session
  const handleLaunchStudy = async (deck: DeckRecord, mode: StudyMode) => {
    const descendantIds = await getDescendantDeckIds(deck.id);
    onStartStudy(descendantIds, deck.name, mode, deck.language);
  };

  // Render tree node
  const renderNode = (node: DeckNode, level: number = 0) => {
    const { deck, children, cumulativeCounts } = node;
    const isExpanded = expandedNodes[deck.id] ?? level < 2;
    const hasChildren = children.length > 0;
    const isRootBook = !deck.parentId;
    const isChapter = level === 1;

    return (
      <div key={deck.id} className="group/node">
        {/* Node Card Row */}
        <div
          data-testid={`deck-node-${deck.id}`}
          className={`flex items-center justify-between p-3.5 rounded-2xl transition-all border ${
            level === 0
              ? 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 shadow-sm mb-2 hover:border-indigo-300 dark:hover:border-indigo-800'
              : level === 1
              ? 'bg-gray-50/70 dark:bg-gray-850/60 border-gray-150 dark:border-gray-800 ml-5 my-1.5'
              : 'bg-white/50 dark:bg-gray-900/40 border-gray-100 dark:border-gray-850 ml-10 my-1'
          }`}
        >
          {/* Left: Expander + Icon + Title */}
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            {hasChildren ? (
              <button
                onClick={() => toggleExpand(deck.id)}
                className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-500 transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>
            ) : (
              <div className="w-6" />
            )}

            <span className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              {isRootBook ? (
                <BookOpen className="w-4 h-4" />
              ) : isChapter ? (
                <Folder className="w-4 h-4" />
              ) : (
                <Layers className="w-4 h-4" />
              )}
            </span>

            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-gray-100 truncate text-sm flex items-center gap-2">
                <span>{deck.name}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 font-mono">
                  {deck.language}
                </span>
              </div>
              <div className="text-[11px] text-gray-400 truncate">
                {isRootBook
                  ? 'Book (Cumulative study available)'
                  : isChapter
                  ? 'Chapter'
                  : 'Deck'}
              </div>
            </div>
          </div>

          {/* Center: Badge Counts (New: Blue, Learn: Amber, Due: Green) */}
          <div className="flex items-center gap-2 px-3">
            {cumulativeCounts.newCount > 0 && (
              <span
                title="New Cards"
                className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
              >
                {cumulativeCounts.newCount}
              </span>
            )}
            {cumulativeCounts.learningCount > 0 && (
              <span
                title="Learning Cards"
                className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300"
              >
                {cumulativeCounts.learningCount}
              </span>
            )}
            {cumulativeCounts.reviewCount > 0 && (
              <span
                title="Due Review Cards"
                className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
              >
                {cumulativeCounts.reviewCount}
              </span>
            )}
            {cumulativeCounts.totalDue === 0 && (
              <span className="text-xs text-gray-400 flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Done
              </span>
            )}
          </div>

          {/* Right: Study Action Triggers & Menu */}
          <div className="flex items-center gap-1.5">
            {/* Standard Study Trigger */}
            <button
              onClick={() => handleLaunchStudy(deck, 'standard')}
              disabled={cumulativeCounts.totalDue === 0}
              className={`px-3 py-1.5 rounded-xl font-medium text-xs flex items-center gap-1.5 transition-all ${
                cumulativeCounts.totalDue > 0
                  ? isRootBook
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-indigo-500/20'
                    : 'bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/80 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
              }`}
              title={
                isRootBook
                  ? 'Study Entire Book Cumulatively'
                  : isChapter
                  ? 'Study Chapter Cumulatively'
                  : 'Study Deck'
              }
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>
                {isRootBook
                  ? 'Study Book'
                  : isChapter
                  ? 'Study Chapter'
                  : 'Study'}
              </span>
            </button>

            {/* Micro-Session: Quick 2-Minute Blitz (15 Cards) */}
            <button
              onClick={() => handleLaunchStudy(deck, 'blitz')}
              disabled={cumulativeCounts.totalDue === 0}
              className="p-1.5 rounded-xl text-gray-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/50 transition-colors disabled:opacity-30"
              title="Quick 2-Minute Blitz (15 Cards)"
            >
              <Zap className="w-4 h-4" />
            </button>

            {/* Micro-Session: High-Priority Due Only */}
            <button
              onClick={() => handleLaunchStudy(deck, 'high_priority_due_only')}
              disabled={cumulativeCounts.reviewCount === 0}
              className="p-1.5 rounded-xl text-gray-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors disabled:opacity-30"
              title="High-Priority Due Only (Lowest Retrievability)"
            >
              <Flame className="w-4 h-4" />
            </button>

            {/* Non-Destructive Cram Mode */}
            <button
              onClick={() => handleLaunchStudy(deck, 'cram')}
              disabled={cumulativeCounts.totalDue === 0 && !hasChildren}
              className="p-1.5 rounded-xl text-gray-500 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/50 transition-colors"
              title="Cram Mode: Non-destructive review of all cards ahead of exams"
            >
              <Sparkles className="w-4 h-4" />
            </button>

            {/* Context Actions Dropdown Toggle */}
            <div className="relative">
              <button
                onClick={() =>
                  setSelectedNodeForAction((prev) => (prev === deck.id ? null : deck.id))
                }
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {selectedNodeForAction === deck.id && (
                <div
                  className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 p-1.5 z-40 text-xs animate-fadeIn"
                  onClick={() => setSelectedNodeForAction(null)}
                >
                  {/* Add child node */}
                  {level < 2 && (
                    <button
                      onClick={() =>
                        setIsCreatingDeck({
                          parentId: deck.id,
                          type: level === 0 ? 'chapter' : 'deck',
                        })
                      }
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 flex items-center gap-2"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{level === 0 ? 'Add Chapter' : 'Add Topic Deck'}</span>
                    </button>
                  )}

                  {/* Import Cards / Decks */}
                  <button
                    onClick={() => {
                      setImportTargetDeck(deck);
                      setIsImportModalOpen(true);
                      setSelectedNodeForAction(null);
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 flex items-center gap-2"
                  >
                    <Upload className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Import Cards / Decks</span>
                  </button>

                  {/* Generate Twin Cards */}
                  <button
                    onClick={async () => {
                      const count = await generateTwinCardsForDeck(deck.id);
                      alert(`Generated ${count} missing Meaning -> Character twin cards!`);
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 flex items-center gap-2"
                  >
                    <Layers className="w-3.5 h-3.5 text-purple-500" />
                    <span>Generate Twin Cards</span>
                  </button>

                  <div className="my-1 border-t border-gray-100 dark:border-gray-800" />

                  {/* Export Options */}
                  <button
                    onClick={() => handleExport(deck.id, deck.name, 'markdown')}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 flex items-center gap-2"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export Markdown</span>
                  </button>
                  <button
                    onClick={() => handleExport(deck.id, deck.name, 'csv')}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 flex items-center gap-2"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>
                  <button
                    onClick={() => handleExport(deck.id, deck.name, 'tsv')}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 flex items-center gap-2"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export TSV</span>
                  </button>

                  <div className="my-1 border-t border-gray-100 dark:border-gray-800" />

                  {/* Delete */}
                  <button
                    onClick={() => handleDeleteDeck(deck.id)}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center gap-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Render child nodes if expanded */}
        {isExpanded && children.length > 0 && (
          <div className="space-y-1">{children.map((c) => renderNode(c, level + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Top Header */}
      <div className="px-6 py-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-indigo-600 text-white rounded-xl shadow-md shadow-indigo-500/20">
              <Sparkles className="w-4 h-4" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              PocketSRS <span className="text-xs text-indigo-600 font-mono font-medium">v2.2</span>
            </h1>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Hierarchical Spaced Repetition Engine (FSRS-6)
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Primary Unified Import Button */}
          <button
            onClick={() => {
              setImportTargetDeck(null);
              setIsImportModalOpen(true);
            }}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-indigo-200 dark:border-indigo-850 bg-indigo-50/70 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors flex items-center gap-1.5 shadow-sm"
            title="Import Flashcards, Decks, Spreadsheets, or Anki Collections"
          >
            <Upload className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Import Cards / Decks</span>
          </button>

          <button
            onClick={onOpenCardBrowser}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors flex items-center gap-1.5"
          >
            <Search className="w-4 h-4" />
            <span>Card Browser</span>
          </button>

          <button
            onClick={() => setIsCreatingDeck({ parentId: null, type: 'book' })}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/20 transition-all flex items-center gap-1.5"
          >
            <FolderPlus className="w-4 h-4" />
            <span>New Book</span>
          </button>

          <button
            onClick={onOpenPlanner}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900 transition-colors flex items-center gap-1.5"
            title="Goal-Driven Study Plan Maker"
          >
            <Target className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            <span>Study Planner</span>
          </button>

          <button
            onClick={onOpenSync}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors flex items-center gap-1.5"
            title="Peer-to-Peer & Cloud Sync, Backups, and FSRS Optimizer"
          >
            <Wifi className="w-4 h-4" />
            <span>Sync & Optimize</span>
          </button>

          <button
            onClick={onOpenSettings}
            className="p-2 rounded-xl border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            onClick={onOpenGuide}
            className="p-2 rounded-xl border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors font-bold text-sm"
            title="PocketSRS Knowledge Base & System Guide (?)"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
        {/* Goal-Driven Study Plan Pacing Banner */}
        <StudyPlanBanner onOpenPlanner={onOpenPlanner} />
        {deckTree.length === 0 ? (
          /* Empty State */
          <div className="text-center py-16 px-4 bg-white dark:bg-gray-900 rounded-3xl border border-dashed border-gray-300 dark:border-gray-800 shadow-sm animate-fadeIn">
            <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <BookOpen className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">
              No Decks Created Yet
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
              Create a new curriculum Book or load the sample Minna no Nihongo Japanese deck to experience FSRS-6 immediately.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={handleSeedSample}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-md shadow-indigo-500/20 transition-all flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Load Sample Deck (Minna no Nihongo)
              </button>
              <button
                onClick={() => setIsCreatingDeck({ parentId: null, type: 'book' })}
                className="px-5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-semibold transition-all"
              >
                Create Custom Book
              </button>
            </div>
          </div>
        ) : (
          /* Tree View */
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-gray-400 px-2 font-semibold uppercase tracking-wider">
              <span>Curriculum / Decks</span>
              <div className="flex items-center gap-4">
                <span>New • Learn • Due</span>
                <span>Actions</span>
              </div>
            </div>

            {deckTree.map((root) => renderNode(root))}
          </div>
        )}
      </div>

      {/* Modal: Create Deck / Chapter / Book */}
      {isCreatingDeck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div
            className="w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">
              Create New {isCreatingDeck.type === 'book' ? 'Curriculum Book' : isCreatingDeck.type === 'chapter' ? 'Chapter' : 'Topic Deck'}
            </h3>

            <form onSubmit={handleSaveNewDeck} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newDeckName}
                  onChange={(e) => setNewDeckName(e.target.value)}
                  placeholder={
                    isCreatingDeck.type === 'book'
                      ? 'e.g. Minna no Nihongo'
                      : isCreatingDeck.type === 'chapter'
                      ? 'e.g. Chapter 1'
                      : 'e.g. Vocabulary'
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>

              {isCreatingDeck.type === 'book' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Language (BCP-47 Tag for Web Speech TTS)
                  </label>
                  <select
                    value={newDeckLang}
                    onChange={(e) => setNewDeckLang(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none text-sm"
                  >
                    <option value="ja-JP">Japanese (ja-JP)</option>
                    <option value="zh-CN">Chinese Mandarin (zh-CN)</option>
                    <option value="ko-KR">Korean (ko-KR)</option>
                    <option value="en-US">English (en-US)</option>
                    <option value="es-ES">Spanish (es-ES)</option>
                    <option value="fr-FR">French (fr-FR)</option>
                    <option value="de-DE">German (de-DE)</option>
                  </select>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreatingDeck(null)}
                  className="px-4 py-2 rounded-xl text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-md shadow-indigo-500/20"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unified Modal: Import Cards / Decks / Anki */}
      <ImportModal
        targetDeck={importTargetDeck}
        isOpen={isImportModalOpen}
        onClose={() => {
          setIsImportModalOpen(false);
          setImportTargetDeck(null);
        }}
        onImportComplete={(summary) => {
          alert(summary);
        }}
      />
    </div>
  );
};
