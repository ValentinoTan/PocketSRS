import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Search,
  Filter,
  Flag,
  BookOpen,
  Trash2,
  Edit3,
  Moon,
  Sun,
  ShieldAlert,
  ArrowUpDown,
  Tag,
  CheckCircle,
  Clock,
  EyeOff,
  Flame,
} from 'lucide-react';
import { db, type CardRecord, type NoteRecord, type DeckRecord } from '../storage/db';
import { QuickEditModal } from './QuickEditModal';
import { isCardBuried } from '../engine/rollover';

interface CardBrowserProps {
  onBackToTree: () => void;
  onSelectDeckForStudy?: (deckId: string) => void;
}

export const CardBrowser: React.FC<CardBrowserProps> = ({ onBackToTree, onSelectDeckForStudy }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDeckFilter, setSelectedDeckFilter] = useState<string>('all');
  const [selectedStateFilter, setSelectedStateFilter] = useState<string>('all');
  const [selectedFlagFilter, setSelectedFlagFilter] = useState<string>('all');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('all');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  // Sorting
  const [sortField, setSortField] = useState<'character' | 'state' | 'due' | 'stability' | 'difficulty'>('due');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Live queries from Dexie
  const cards = useLiveQuery(() => db.cards.filter((c) => !c.deletedAt || c.deletedAt === 0).toArray(), []);
  const notes = useLiveQuery(() => db.notes.filter((n) => !n.deletedAt || n.deletedAt === 0).toArray(), []);
  const decks = useLiveQuery(() => db.decks.filter((d) => !d.deletedAt || d.deletedAt === 0).toArray(), []);

  // Map notes and decks for rapid lookups
  const noteMap = useMemo(() => {
    const map = new Map<string, NoteRecord>();
    if (notes) {
      for (const n of notes) {
        map.set(n.id, n);
      }
    }
    return map;
  }, [notes]);

  const deckMap = useMemo(() => {
    const map = new Map<string, DeckRecord>();
    if (decks) {
      for (const d of decks) {
        map.set(d.id, d);
      }
    }
    return map;
  }, [decks]);

  // Extract all unique tags across notes
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    if (notes) {
      for (const n of notes) {
        if (n.tags) {
          n.tags.forEach((t) => tags.add(t));
        }
      }
    }
    return Array.from(tags).sort();
  }, [notes]);

  // Combined filtered cards
  const filteredCards = useMemo(() => {
    if (!cards || !notes) return [];

    const query = searchQuery.trim().toLowerCase();

    return cards.filter((card) => {
      const note = noteMap.get(card.noteId);
      if (!note) return false;

      // Deck filter
      if (selectedDeckFilter !== 'all') {
        const matchesPrimary = card.deckId === selectedDeckFilter;
        const matchesSecondary = card.secondaryDeckIds?.includes(selectedDeckFilter);
        if (!matchesPrimary && !matchesSecondary) return false;
      }

      // State filter
      const isBuried = isCardBuried(card);
      if (selectedStateFilter === 'new' && card.state !== 0) return false;
      if (selectedStateFilter === 'learning' && card.state !== 1) return false;
      if (selectedStateFilter === 'review' && card.state !== 2) return false;
      if (selectedStateFilter === 'relearning' && card.state !== 3) return false;
      if (selectedStateFilter === 'suspended' && !card.isSuspended) return false;
      if (selectedStateFilter === 'buried' && !isBuried) return false;
      if (selectedStateFilter === 'leech' && !card.isLeech) return false;

      // Flag filter
      if (selectedFlagFilter !== 'all') {
        if (selectedFlagFilter === 'unflagged' && card.isFlagged) return false;
        if (selectedFlagFilter !== 'unflagged' && card.isFlagged !== selectedFlagFilter) return false;
      }

      // Tag filter
      if (selectedTagFilter !== 'all') {
        if (!note.tags || !note.tags.includes(selectedTagFilter)) return false;
      }

      // Search Query
      if (query) {
        const charMatch = note.character.toLowerCase().includes(query);
        const readingMatch = (note.reading || '').toLowerCase().includes(query);
        const meaningMatch = note.meaning.toLowerCase().includes(query);
        const exampleMatch = (note.exampleSentence || '').toLowerCase().includes(query);
        const notesMatch = (note.notes || '').toLowerCase().includes(query);
        const tagMatch = note.tags?.some((t) => t.toLowerCase().includes(query));

        if (!charMatch && !readingMatch && !meaningMatch && !exampleMatch && !notesMatch && !tagMatch) {
          return false;
        }
      }

      return true;
    });
  }, [cards, noteMap, searchQuery, selectedDeckFilter, selectedStateFilter, selectedFlagFilter, selectedTagFilter]);

  // Sorted cards
  const sortedCards = useMemo(() => {
    return [...filteredCards].sort((a, b) => {
      let comparison = 0;
      const noteA = noteMap.get(a.noteId);
      const noteB = noteMap.get(b.noteId);

      if (sortField === 'character') {
        const charA = noteA?.character || '';
        const charB = noteB?.character || '';
        comparison = charA.localeCompare(charB);
      } else if (sortField === 'state') {
        comparison = a.state - b.state;
      } else if (sortField === 'due') {
        comparison = a.due - b.due;
      } else if (sortField === 'stability') {
        comparison = a.stability - b.stability;
      } else if (sortField === 'difficulty') {
        comparison = a.difficulty - b.difficulty;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredCards, noteMap, sortField, sortDirection]);

  // Handlers for card actions
  const handleToggleSuspend = async (card: CardRecord) => {
    await db.cards.update(card.id, {
      isSuspended: !card.isSuspended,
      updatedAt: Date.now(),
    });
  };

  const handleToggleBury = async (card: CardRecord) => {
    const isBuried = isCardBuried(card);
    await db.cards.update(card.id, {
      buriedUntil: isBuried ? null : Date.now() + 86400000,
      updatedAt: Date.now(),
    });
  };

  const handleDeleteCard = async (card: CardRecord) => {
    if (confirm('Are you sure you want to delete this card and its note?')) {
      await db.cards.update(card.id, {
        deletedAt: Date.now(),
      });
      // Soft-delete sibling cards and note
      const siblings = await db.cards.where('noteId').equals(card.noteId).toArray();
      for (const sib of siblings) {
        await db.cards.update(sib.id, { deletedAt: Date.now() });
      }
      await db.notes.update(card.noteId, { deletedAt: Date.now() });
    }
  };

  const handleCycleFlag = async (card: CardRecord) => {
    const flags: (CardRecord['isFlagged'])[] = [null, 'red', 'orange', 'blue'];
    const currentIdx = flags.indexOf(card.isFlagged || null);
    const nextFlag = flags[(currentIdx + 1) % flags.length];
    await db.cards.update(card.id, {
      isFlagged: nextFlag,
      updatedAt: Date.now(),
    });
  };

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Top Bar */}
      <div className="px-6 py-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToTree}
            className="px-3.5 py-1.5 text-sm font-medium rounded-xl border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5"
          >
            ← Decks
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Card Browser</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {filteredCards.length} {filteredCards.length === 1 ? 'card' : 'cards'} matching filters
            </p>
          </div>
        </div>

        {/* Global Search Bar */}
        <div className="relative flex-1 max-w-md min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search characters, readings, meanings, tags..."
            className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:bg-white dark:focus:bg-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Filter Chips Bar */}
      <div className="px-6 py-3 bg-white/70 dark:bg-gray-900/70 border-b border-gray-200 dark:border-gray-800 backdrop-blur-sm flex flex-wrap items-center gap-3 text-xs">
        {/* Deck Filter */}
        <div className="flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-gray-400" />
          <select
            value={selectedDeckFilter}
            onChange={(e) => setSelectedDeckFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 outline-none"
          >
            <option value="all">All Decks & Chapters</option>
            {decks?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.path || d.name}
              </option>
            ))}
          </select>
        </div>

        {/* State Filter */}
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-gray-400" />
          <select
            value={selectedStateFilter}
            onChange={(e) => setSelectedStateFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 outline-none"
          >
            <option value="all">All States</option>
            <option value="new">New (0)</option>
            <option value="learning">Learning (1)</option>
            <option value="review">Review (2)</option>
            <option value="relearning">Relearning (3)</option>
            <option value="buried">Buried</option>
            <option value="suspended">Suspended</option>
            <option value="leech">Leech (Stuck)</option>
          </select>
        </div>

        {/* Flag Filter */}
        <div className="flex items-center gap-1.5">
          <Flag className="w-3.5 h-3.5 text-gray-400" />
          <select
            value={selectedFlagFilter}
            onChange={(e) => setSelectedFlagFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 outline-none"
          >
            <option value="all">All Flags</option>
            <option value="red">🔴 Red Flag</option>
            <option value="orange">🟠 Orange Flag</option>
            <option value="blue">🔵 Blue Flag</option>
            <option value="unflagged">Unflagged Only</option>
          </select>
        </div>

        {/* Tag Filter */}
        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-gray-400" />
            <select
              value={selectedTagFilter}
              onChange={(e) => setSelectedTagFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 outline-none"
            >
              <option value="all">All Tags</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>
                  #{tag}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Table Container */}
      <div className="flex-1 overflow-auto p-6">
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/75 dark:bg-gray-800/50 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th className="py-3 px-4 w-12 text-center">Flag</th>
                <th
                  onClick={() => handleSort('character')}
                  className="py-3 px-4 cursor-pointer hover:text-indigo-600 select-none"
                >
                  <div className="flex items-center gap-1">
                    Front / Character <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="py-3 px-4">Meaning / Back</th>
                <th className="py-3 px-4">Deck / Hierarchy</th>
                <th
                  onClick={() => handleSort('state')}
                  className="py-3 px-4 cursor-pointer hover:text-indigo-600 select-none"
                >
                  <div className="flex items-center gap-1">
                    State <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('due')}
                  className="py-3 px-4 cursor-pointer hover:text-indigo-600 select-none"
                >
                  <div className="flex items-center gap-1">
                    Due / Interval <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('stability')}
                  className="py-3 px-4 cursor-pointer hover:text-indigo-600 select-none hidden lg:table-cell"
                >
                  <div className="flex items-center gap-1">
                    Stability (S) <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('difficulty')}
                  className="py-3 px-4 cursor-pointer hover:text-indigo-600 select-none hidden lg:table-cell"
                >
                  <div className="flex items-center gap-1">
                    Diff (D) <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {sortedCards.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-gray-400">
                    No cards match your filter criteria.
                  </td>
                </tr>
              ) : (
                sortedCards.map((card) => {
                  const note = noteMap.get(card.noteId);
                  const deck = deckMap.get(card.deckId);
                  const isBuried = isCardBuried(card);

                  let stateBadge = null;
                  if (card.isSuspended) {
                    stateBadge = (
                      <span className="px-2 py-0.5 text-xs rounded-md bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium">
                        Suspended
                      </span>
                    );
                  } else if (isBuried) {
                    stateBadge = (
                      <span className="px-2 py-0.5 text-xs rounded-md bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-medium">
                        Buried
                      </span>
                    );
                  } else if (card.state === 0) {
                    stateBadge = (
                      <span className="px-2 py-0.5 text-xs rounded-md bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-medium">
                        New
                      </span>
                    );
                  } else if (card.state === 1) {
                    stateBadge = (
                      <span className="px-2 py-0.5 text-xs rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-medium">
                        Learning
                      </span>
                    );
                  } else if (card.state === 2) {
                    stateBadge = (
                      <span className="px-2 py-0.5 text-xs rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-medium">
                        Review
                      </span>
                    );
                  } else {
                    stateBadge = (
                      <span className="px-2 py-0.5 text-xs rounded-md bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-medium">
                        Relearn
                      </span>
                    );
                  }

                  return (
                    <tr
                      key={card.id}
                      className="hover:bg-gray-50/70 dark:hover:bg-gray-800/40 transition-colors group"
                    >
                      {/* Flag Column */}
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => handleCycleFlag(card)}
                          title="Click to cycle flag color"
                          className="p-1 hover:scale-125 transition-transform"
                        >
                          {card.isFlagged === 'red' && <span className="text-red-500 font-bold">🚩</span>}
                          {card.isFlagged === 'orange' && <span className="text-orange-500 font-bold">🚩</span>}
                          {card.isFlagged === 'blue' && <span className="text-blue-500 font-bold">🚩</span>}
                          {!card.isFlagged && <span className="text-gray-300 dark:text-gray-700">⚑</span>}
                        </button>
                      </td>

                      {/* Front / Character & Reading */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                          {note?.character}
                          {card.isLeech && (
                            <span title="Leech Card (Frequent lapses)">
                              <Flame className="w-3.5 h-3.5 text-amber-500" />
                            </span>
                          )}
                        </div>
                        {note?.reading && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {note.reading}
                          </div>
                        )}
                        {card.direction === 'production' && (
                          <span className="inline-block mt-0.5 text-[10px] px-1 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-500">
                            Production Twin
                          </span>
                        )}
                      </td>

                      {/* Meaning */}
                      <td className="py-3 px-4 max-w-xs">
                        <div className="truncate text-gray-800 dark:text-gray-200">
                          {note?.meaning}
                        </div>
                        {note?.tags && note.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {note.tags.map((t) => (
                              <span
                                key={t}
                                className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* Deck */}
                      <td className="py-3 px-4 text-xs text-gray-600 dark:text-gray-400">
                        {deck?.path || deck?.name || 'Unknown Deck'}
                        {card.secondaryDeckIds && card.secondaryDeckIds.length > 0 && (
                          <div className="text-[10px] text-indigo-500">
                            +{card.secondaryDeckIds.length} linked chapter(s)
                          </div>
                        )}
                      </td>

                      {/* State Badge */}
                      <td className="py-3 px-4">{stateBadge}</td>

                      {/* Due / Interval */}
                      <td className="py-3 px-4 text-xs">
                        <div className="font-medium text-gray-700 dark:text-gray-300">
                          {card.state === 0
                            ? 'New'
                            : new Date(card.due).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                              })}
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {card.scheduledDays > 0 ? `${card.scheduledDays}d int` : '0d'}
                        </div>
                      </td>

                      {/* Stability */}
                      <td className="py-3 px-4 text-xs font-mono text-gray-600 dark:text-gray-400 hidden lg:table-cell">
                        {card.stability ? `${card.stability.toFixed(1)}d` : '-'}
                      </td>

                      {/* Difficulty */}
                      <td className="py-3 px-4 text-xs font-mono text-gray-600 dark:text-gray-400 hidden lg:table-cell">
                        {card.difficulty ? `${card.difficulty.toFixed(1)}` : '-'}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditingNoteId(card.noteId)}
                            title="Quick Edit (E)"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-indigo-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleToggleBury(card)}
                            title={isBuried ? 'Unbury Card' : 'Bury until Tomorrow'}
                            className="p-1.5 rounded-lg text-gray-500 hover:text-purple-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                          >
                            <Clock className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleToggleSuspend(card)}
                            title={card.isSuspended ? 'Unsuspend Card' : 'Suspend Card'}
                            className="p-1.5 rounded-lg text-gray-500 hover:text-amber-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                          >
                            <EyeOff className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteCard(card)}
                            title="Delete Card"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-rose-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Edit Modal */}
      <QuickEditModal
        noteId={editingNoteId}
        isOpen={Boolean(editingNoteId)}
        onClose={() => setEditingNoteId(null)}
      />
    </div>
  );
};
