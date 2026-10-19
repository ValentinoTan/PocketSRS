import React, { useEffect, useState } from 'react';
import { X, Sparkles, BookOpen, Layers } from 'lucide-react';
import { db, type NoteRecord, type CardRecord, type DeckRecord } from '../storage/db';

interface RadicalDrawerProps {
  radical: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSelectCard?: (card: CardRecord, note: NoteRecord) => void;
}

interface MatchingItem {
  note: NoteRecord;
  card: CardRecord;
  deckName: string;
}

export const RadicalDrawer: React.FC<RadicalDrawerProps> = ({
  radical,
  isOpen,
  onClose,
  onSelectCard,
}) => {
  const [matchingItems, setMatchingItems] = useState<MatchingItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !radical) {
      setMatchingItems([]);
      return;
    }

    let isMounted = true;
    setLoading(true);

    (async () => {
      // Find notes containing this radical component
      const notes = await db.notes
        .where('radicals')
        .equals(radical)
        .toArray();

      const validNotes = notes.filter((n) => !n.deletedAt || n.deletedAt === 0);
      const noteIds = validNotes.map((n) => n.id);

      const cards = await db.cards
        .where('noteId')
        .anyOf(noteIds)
        .toArray();

      const allDecks = await db.decks.toArray();
      const deckMap = new Map(allDecks.map((d) => [d.id, d.name]));

      const items: MatchingItem[] = [];
      const seenCardIds = new Set<string>();

      for (const note of validNotes) {
        const noteCards = cards.filter((c) => c.noteId === note.id && (!c.deletedAt || c.deletedAt === 0));
        for (const card of noteCards) {
          if (!seenCardIds.has(card.id)) {
            seenCardIds.add(card.id);
            items.push({
              note,
              card,
              deckName: deckMap.get(card.deckId) || 'Deck',
            });
          }
        }
      }

      if (isMounted) {
        setMatchingItems(items);
        setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [radical, isOpen]);

  if (!isOpen || !radical) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-sm animate-fadeIn">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div
          className="w-screen max-w-md bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-800 flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drawer Header */}
          <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/40 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-bold text-xl flex items-center justify-center border border-indigo-200/50 dark:border-indigo-800/50">
                {radical}
              </span>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-gray-100 text-base">
                  Component Explorer
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {matchingItems.length} cards share this radical
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Drawer Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-3">
            {loading ? (
              <div className="py-12 text-center">
                <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                <span className="text-xs text-gray-400">Searching related cards...</span>
              </div>
            ) : matchingItems.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">
                No other cards currently share radical <span className="font-bold">{radical}</span>.
              </div>
            ) : (
              matchingItems.map((item) => (
                <div
                  key={item.card.id}
                  onClick={() => onSelectCard?.(item.card, item.note)}
                  className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800/40 hover:border-indigo-400 dark:hover:border-indigo-600 shadow-sm transition-all cursor-pointer group"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold text-gray-900 dark:text-gray-100 group-hover:text-indigo-600 transition-colors">
                        {item.note.character}
                      </span>
                      {item.note.reading && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                          ({item.note.reading})
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-semibold truncate max-w-[120px]">
                      {item.deckName}
                    </span>
                  </div>

                  <div className="text-xs text-gray-700 dark:text-gray-300 leading-snug">
                    {item.note.meaning}
                  </div>

                  {item.note.exampleSentence && (
                    <div className="mt-2 text-[11px] text-gray-400 italic line-clamp-1">
                      {item.note.exampleSentence}
                    </div>
                  )}

                  {/* Components chips */}
                  {item.note.radicals && item.note.radicals.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2.5">
                      {item.note.radicals.map((rad, idx) => (
                        <span
                          key={idx}
                          className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                            rad === radical
                              ? 'bg-indigo-600 text-white font-bold'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                          }`}
                        >
                          {rad}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
