import React, { useState, useEffect } from 'react';
import { X, Save, Sparkles, Tag, Volume2 } from 'lucide-react';
import { db, type NoteRecord } from '../storage/db';

interface QuickEditModalProps {
  noteId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (updatedNote: NoteRecord) => void;
  language?: string;
}

export const QuickEditModal: React.FC<QuickEditModalProps> = ({
  noteId,
  isOpen,
  onClose,
  onSaved,
  language = 'ja-JP',
}) => {
  const [character, setCharacter] = useState('');
  const [reading, setReading] = useState('');
  const [meaning, setMeaning] = useState('');
  const [exampleSentence, setExampleSentence] = useState('');
  const [notes, setNotes] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [radicalsInput, setRadicalsInput] = useState('');
  const [pitchOrTone, setPitchOrTone] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !noteId) return;

    let isMounted = true;
    db.notes.get(noteId).then((note) => {
      if (!isMounted || !note) return;
      setCharacter(note.character || '');
      setReading(note.reading || '');
      setMeaning(note.meaning || '');
      setExampleSentence(note.exampleSentence || '');
      setNotes(note.notes || '');
      setTagsInput(note.tags ? note.tags.join(', ') : '');
      setRadicalsInput(note.radicals ? note.radicals.join(', ') : '');
      setPitchOrTone(note.pitchOrTone || '');
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      isMounted = false;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, noteId, character, meaning, reading, exampleSentence, notes, tagsInput, radicalsInput, pitchOrTone]);

  if (!isOpen || !noteId) return null;

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!character.trim() || !meaning.trim()) return;

    setLoading(true);
    try {
      const existing = await db.notes.get(noteId);
      if (!existing) return;

      const tags = tagsInput
        .split(/[,;\s]+/)
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean);

      const radicals = radicalsInput
        .split(/[,;\s]+/)
        .map((r) => r.trim())
        .filter(Boolean);

      const updatedNote: NoteRecord = {
        ...existing,
        character: character.trim(),
        reading: reading.trim(),
        meaning: meaning.trim(),
        exampleSentence: exampleSentence.trim() || undefined,
        notes: notes.trim() || undefined,
        tags,
        radicals: radicals.length > 0 ? radicals : undefined,
        pitchOrTone: pitchOrTone.trim() || undefined,
        updatedAt: Date.now(),
      };

      await db.notes.put(updatedNote);
      onSaved?.(updatedNote);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleTestTTS = () => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(character);
    utterance.lang = language;
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div
        className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-lg">
              <Sparkles className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Quick Edit Note</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Hotkey: Esc to close, Ctrl+Enter to save</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form
          onSubmit={handleSave}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              handleSave();
            }
          }}
          className="p-6 overflow-y-auto space-y-4 flex-1 text-sm"
        >
          {/* Character & Reading */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-medium text-gray-700 dark:text-gray-300">
                  Target Character / Term <span className="text-red-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={handleTestTTS}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
                  title="Test Speech"
                >
                  <Volume2 className="w-3.5 h-3.5" /> Test Voice
                </button>
              </div>
              <input
                type="text"
                required
                value={character}
                onChange={(e) => setCharacter(e.target.value)}
                placeholder="e.g. 食べる"
                className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all font-medium text-base"
              />
            </div>

            <div>
              <label className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
                Phonetic Reading (Furigana / Pinyin / IPA)
              </label>
              <input
                type="text"
                value={reading}
                onChange={(e) => setReading(e.target.value)}
                placeholder="e.g. たべる"
                className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-base"
              />
            </div>
          </div>

          {/* Meaning */}
          <div>
            <label className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
              Meaning / Translation <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={2}
              value={meaning}
              onChange={(e) => setMeaning(e.target.value)}
              placeholder="e.g. To eat; to consume food"
              className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all resize-none"
            />
          </div>

          {/* Example Sentence */}
          <div>
            <label className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
              Contextual Example Sentence
            </label>
            <input
              type="text"
              value={exampleSentence}
              onChange={(e) => setExampleSentence(e.target.value)}
              placeholder="e.g. 毎日りんごを食べます。"
              className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
            />
          </div>

          {/* Radicals and Pitch / Tone */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
                Radicals / Components
              </label>
              <input
                type="text"
                value={radicalsInput}
                onChange={(e) => setRadicalsInput(e.target.value)}
                placeholder="e.g. 食, 乞 (comma-separated)"
                className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            <div>
              <label className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
                Pitch Accent / Tone
              </label>
              <input
                type="text"
                value={pitchOrTone}
                onChange={(e) => setPitchOrTone(e.target.value)}
                placeholder="e.g. [2] または 4声"
                className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
              Notes & Mnemonics
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Transitive verb (Ichidan / Group 2)"
              className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all resize-none"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="flex items-center gap-1 font-medium text-gray-700 dark:text-gray-300 mb-1">
              <Tag className="w-3.5 h-3.5" /> Categorization Tags
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. verb, JLPT-N5, Chapter-1 (comma or space separated)"
              className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
            />
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => handleSave()}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-md shadow-indigo-500/20 flex items-center gap-2 transition-all disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {loading ? 'Saving...' : 'Save Note'}
          </button>
        </div>
      </div>
    </div>
  );
};
