import { v4 as uuidv4 } from 'uuid';
import {
  db,
  type DeckRecord,
  type NoteRecord,
  type CardRecord,
} from '../storage/db';

export type DuplicateStrategy = 'skip' | 'merge' | 'separate';

export interface ParsedItem {
  character: string;
  reading?: string;
  meaning: string;
  exampleSentence?: string;
  notes?: string;
  tags?: string[];
  pitchOrTone?: string;
  radicals?: string[];
  book?: string;
  chapter?: string;
}


export interface ImportPreviewItem {
  item: ParsedItem;
  duplicateOfNoteId?: string;
  existingCardId?: string;
  existingDeckNames?: string[];
  status: 'new' | 'duplicate';
}

export interface ImportResult {
  totalProcessed: number;
  createdNotes: number;
  createdCards: number;
  mergedCards: number;
  skipped: number;
}

/**
 * Extracts inline reading notation from text, e.g.:
 * "食べる(たべる)" => { character: "食べる", reading: "たべる" }
 * "漢[かん]" => { character: "漢", reading: "かん" }
 * "你好（nǐ hǎo）" => { character: "你好", reading: "nǐ hǎo" }
 */
export function extractInlineReading(rawText: string): { character: string; reading?: string } {
  const trimmed = rawText.trim();
  // Match character(reading) with standard ASCII or CJK full-width parentheses / square brackets
  const match = trimmed.match(/^([^\(\[\uff08]+)[\(\[\uff08]([^\)\]\uff09]+)[\)\]\uff09]$/);
  if (match) {
    return {
      character: match[1].trim(),
      reading: match[2].trim(),
    };
  }
  return { character: trimmed };
}

/**
 * Parses Markdown Quick-Paste syntax:
 * Format: "食べる(たべる) :: To eat // 毎日りんごを食べます (I eat an apple every day) #verb #n5"
 * - Delimiter `::` separates Character/Reading from Meaning
 * - Delimiter `//` separates Meaning from Example Sentence
 * - Trailing `(notes)` or inline `#tags` are extracted
 */
export function parseMarkdownQuickPaste(content: string): ParsedItem[] {
  const lines = content.split(/\r?\n/);
  const items: ParsedItem[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('# ') || line.startsWith('//')) continue;

    // Check for `::` delimiter
    if (line.includes('::')) {
      const [frontPart, ...backParts] = line.split('::');
      const back = backParts.join('::').trim();

      // Extract inline reading from front
      const { character, reading } = extractInlineReading(frontPart.trim());

      let meaning = back;
      let exampleSentence: string | undefined;
      let notes: string | undefined;
      const tags: string[] = [];

      // Extract trailing tags (e.g., #jlpt-n5 #verb)
      const tagMatches = meaning.match(/#[a-zA-Z0-9_\-\u4e00-\u9fa5\u3040-\u30ff]+/g);
      if (tagMatches) {
        for (const t of tagMatches) {
          tags.push(t.replace('#', ''));
          meaning = meaning.replace(t, '');
        }
        meaning = meaning.trim();
      }

      // Check for `//` example sentence delimiter
      if (meaning.includes('//')) {
        const [mPart, ...exParts] = meaning.split('//');
        meaning = mPart.trim();
        let exText = exParts.join('//').trim();

        // Check if example has trailing notes in parentheses: "毎日りんごを食べます (Daily note)"
        const noteMatch = exText.match(/\(([^)]+)\)$/);
        if (noteMatch) {
          notes = noteMatch[1].trim();
          exText = exText.replace(/\(([^)]+)\)$/, '').trim();
        }
        exampleSentence = exText;
      } else {
        // Check if meaning itself has trailing notes
        const noteMatch = meaning.match(/\(([^)]+)\)$/);
        if (noteMatch) {
          notes = noteMatch[1].trim();
          meaning = meaning.replace(/\(([^)]+)\)$/, '').trim();
        }
      }

      if (character && meaning) {
        items.push({
          character,
          reading,
          meaning,
          exampleSentence,
          notes,
          tags,
        });
      }
    }
  }

  return items;
}

/**
 * Helper to auto-detect language from script
 */
export function detectLanguage(text: string): string {
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) {
    return 'ja-JP';
  }
  if (/[\uac00-\ud7af\u1100-\u11ff]/.test(text)) {
    return 'ko-KR';
  }
  if (/[\u4e00-\u9fa5]/.test(text)) {
    return 'zh-CN';
  }
  return 'en-US';
}

/**
 * Parses JSON formatted flashcard data (array of objects or nested lesson dictionaries).
 */
export function parseJsonText(content: string): ParsedItem[] {
  try {
    const data = JSON.parse(content);
    const items: ParsedItem[] = [];

    const processItem = (obj: any, defaultBook?: string, defaultChapter?: string) => {
      if (!obj || typeof obj !== 'object') return;
      const character = obj.character || obj.kanji || obj.word || obj.term || obj.front || obj.japanese || '';
      const meaning = obj.meaning || obj.translation || obj.definition || obj.back || obj.english || '';
      const reading = obj.reading || obj.kana || obj.furigana || obj.pinyin || '';
      const exampleSentence = obj.exampleSentence || obj.example || obj.sentence || '';
      const notes = obj.notes || obj.note || obj.mnemonic || '';
      const tags = Array.isArray(obj.tags)
        ? obj.tags
        : typeof obj.tags === 'string'
        ? obj.tags.split(/[,;\s]+/).filter(Boolean)
        : [];
      const pitchOrTone = obj.pitchOrTone || obj.pitch || obj.tone || '';
      const radicals = Array.isArray(obj.radicals)
        ? obj.radicals
        : typeof obj.radicals === 'string'
        ? obj.radicals.split(/[,;\s]+/).filter(Boolean)
        : undefined;
      const book = obj.book || defaultBook;
      const chapter = obj.chapter || obj.lesson || defaultChapter;

      if (character && meaning) {
        items.push({
          character: String(character).trim(),
          reading: reading ? String(reading).trim() : undefined,
          meaning: String(meaning).trim(),
          exampleSentence: exampleSentence ? String(exampleSentence).trim() : undefined,
          notes: notes ? String(notes).trim() : undefined,
          tags,
          pitchOrTone: pitchOrTone ? String(pitchOrTone).trim() : undefined,
          radicals,
          book: book ? String(book).trim() : undefined,
          chapter: chapter ? String(chapter).trim() : undefined,
        });
      }
    };

    if (Array.isArray(data)) {
      for (const entry of data) {
        processItem(entry);
      }
    } else if (typeof data === 'object' && data !== null) {
      for (const [key, val] of Object.entries(data)) {
        if (Array.isArray(val)) {
          const isLesson = key.toLowerCase().includes('lesson') || key.toLowerCase().includes('chap');
          for (const entry of val) {
            processItem(entry, undefined, isLesson ? key : undefined);
          }
        } else if (key === 'cards' || key === 'notes' || key === 'items') {
          if (Array.isArray(val)) {
            for (const entry of val) processItem(entry);
          }
        }
      }
    }

    return items;
  } catch (err) {
    console.error('Failed to parse JSON content:', err);
    return [];
  }
}

/**
 * Parses CSV / TSV text with automatic delimiter detection, RFC-compliant quote & multiline handling,
 * and column mapping for character, meaning, reading, exampleSentence, notes, tags, book, chapter.
 */
export function parseDelimitedText(rawContent: string, delimiter?: string): ParsedItem[] {
  const content = rawContent.replace(/^\uFEFF/, '');
  if (!content.trim()) return [];

  // Auto-detect delimiter if not explicitly provided
  if (!delimiter) {
    const firstLineEnd = content.indexOf('\n');
    const firstLine = firstLineEnd >= 0 ? content.slice(0, firstLineEnd) : content;
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;

    if (tabCount >= commaCount && tabCount >= semicolonCount && tabCount > 0) {
      delimiter = '\t';
    } else if (semicolonCount > commaCount && semicolonCount > 0) {
      delimiter = ';';
    } else {
      delimiter = ',';
    }
  }

  // Tokenize rows considering quotes (RFC 4180 compliant)
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (char === '"') {
      if (inQuotes && content[i + 1] === '"') {
        currentField += '"';
        i++; // skip next escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && content[i + 1] === '\n') {
        i++; // skip \n in \r\n
      }
      currentRow.push(currentField.trim());
      if (currentRow.some((f) => f.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((f) => f.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) return [];

  // Check if first row is header
  const firstRow = rows[0].map((c) => c.toLowerCase().trim().replace(/['"_\s-]/g, ''));
  let hasHeader = false;
  let charIdx = 0;
  let readingIdx = -1;
  let meaningIdx = 1;
  let exampleIdx = -1;
  let notesIdx = -1;
  let tagsIdx = -1;
  let pitchIdx = -1;
  let radicalsIdx = -1;
  let bookIdx = -1;
  let chapterIdx = -1;

  for (let i = 0; i < firstRow.length; i++) {
    const col = firstRow[i];
    if (
      col.includes('char') ||
      col.includes('term') ||
      col.includes('word') ||
      col.includes('front') ||
      col.includes('kanji') ||
      col.includes('hanzi') ||
      col.includes('vocab') ||
      col.includes('target')
    ) {
      charIdx = i;
      hasHeader = true;
    } else if (
      col.includes('read') ||
      col.includes('kana') ||
      col.includes('pinyin') ||
      col.includes('furigana') ||
      col.includes('pronun')
    ) {
      readingIdx = i;
      hasHeader = true;
    } else if (
      col.includes('mean') ||
      col.includes('def') ||
      col.includes('back') ||
      col.includes('trans') ||
      col.includes('english')
    ) {
      meaningIdx = i;
      hasHeader = true;
    } else if (col.includes('example') || col.includes('sentence')) {
      exampleIdx = i;
      hasHeader = true;
    } else if (col.includes('note') || col.includes('mnemonic') || col.includes('comment')) {
      notesIdx = i;
      hasHeader = true;
    } else if (col.includes('tag')) {
      tagsIdx = i;
      hasHeader = true;
    } else if (col.includes('pitch') || col.includes('tone') || col.includes('accent')) {
      pitchIdx = i;
      hasHeader = true;
    } else if (col.includes('rad') || col.includes('component')) {
      radicalsIdx = i;
      hasHeader = true;
    } else if (
      col.includes('book') ||
      col.includes('curriculum') ||
      col.includes('textbook') ||
      col.includes('deck')
    ) {
      bookIdx = i;
      hasHeader = true;
    } else if (col.includes('chap') || col.includes('lesson') || col.includes('unit')) {
      chapterIdx = i;
      hasHeader = true;
    }
  }

  // Fallback for headerless 3-column files (e.g. Kanji \t Reading \t Meaning)
  if (!hasHeader && rows.length > 0 && rows[0].length >= 3) {
    const col1 = rows[0][1] || '';
    const col2 = rows[0][2] || '';
    if (/[\u3040-\u30ff]/.test(col1) || /^[a-zA-Z0-9\s.,!?'"()-]+$/.test(col2)) {
      readingIdx = 1;
      meaningIdx = 2;
    }
  }

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const items: ParsedItem[] = [];

  for (const row of dataRows) {
    if (row.length === 0) continue;
    const rawChar = row[charIdx] || '';
    if (!rawChar) continue;

    // Check if character column contains inline reading
    const { character, reading: inlineReading } = extractInlineReading(rawChar);
    const reading = readingIdx >= 0 && row[readingIdx] ? row[readingIdx] : inlineReading;
    const meaning = row[meaningIdx] || '';
    const exampleSentence = exampleIdx >= 0 ? row[exampleIdx] : undefined;
    const notes = notesIdx >= 0 ? row[notesIdx] : undefined;
    const tags = tagsIdx >= 0 && row[tagsIdx] ? row[tagsIdx].split(/[,;\s]+/).filter(Boolean) : [];
    const pitchOrTone = pitchIdx >= 0 ? row[pitchIdx] : undefined;
    const radicals = radicalsIdx >= 0 && row[radicalsIdx]
      ? row[radicalsIdx].split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
      : undefined;
    const book = bookIdx >= 0 && row[bookIdx] ? row[bookIdx].trim() : undefined;
    const chapter = chapterIdx >= 0 && row[chapterIdx] ? row[chapterIdx].trim() : undefined;

    if (character && meaning) {
      items.push({
        character,
        reading,
        meaning,
        exampleSentence,
        notes,
        tags,
        pitchOrTone,
        radicals,
        book,
        chapter,
      });
    }
  }

  return items;
}


/**
 * Inspects a list of parsed items against existing notes in the database
 * to identify potential duplicates on [character + reading].
 */
export async function inspectDuplicates(items: ParsedItem[]): Promise<ImportPreviewItem[]> {
  const allDecks = await db.decks.toArray();
  const deckMap = new Map(allDecks.map((d) => [d.id, d.name]));

  const previews: ImportPreviewItem[] = [];

  for (const item of items) {
    const readingKey = item.reading || '';
    // Look up existing note by [character + reading]
    const existing = await db.notes
      .where('[character+reading]')
      .equals([item.character, readingKey])
      .first();

    if (existing && (!existing.deletedAt || existing.deletedAt === 0)) {
      // Find cards associated with existing note
      const existingCards = await db.cards.where('noteId').equals(existing.id).toArray();
      const existingCard = existingCards[0];

      const deckNames: string[] = [];
      if (existingCard) {
        if (deckMap.has(existingCard.deckId)) {
          deckNames.push(deckMap.get(existingCard.deckId)!);
        }
        if (existingCard.secondaryDeckIds) {
          for (const sId of existingCard.secondaryDeckIds) {
            if (deckMap.has(sId)) {
              deckNames.push(deckMap.get(sId)!);
            }
          }
        }
      }

      previews.push({
        item,
        duplicateOfNoteId: existing.id,
        existingCardId: existingCard?.id,
        existingDeckNames: deckNames,
        status: 'duplicate',
      });
    } else {
      previews.push({
        item,
        status: 'new',
      });
    }
  }

  return previews;
}

/**
 * Imports parsed items into target deck (or dynamically resolves Book -> Chapter hierarchy if specified in items)
 * with duplicate handling strategy:
 * - 'skip': Skip duplicate note/card
 * - 'merge': Append assigned deckId to existing CardRecord.secondaryDeckIds and merge tags
 * - 'separate': Create new NoteRecord and CardRecord regardless
 */
export async function importParsedItems(
  items: ParsedItem[],
  targetDeckId?: string | null,
  duplicateStrategy: DuplicateStrategy = 'merge'
): Promise<ImportResult> {
  const allDecks = await db.decks.toArray();
  const deckCache = new Map<string, DeckRecord>();
  for (const d of allDecks) {
    if (!d.deletedAt || d.deletedAt === 0) {
      deckCache.set(d.id, d);
    }
  }

  const initialTargetDeck = targetDeckId ? deckCache.get(targetDeckId) || (await db.decks.get(targetDeckId)) : null;
  const now = Date.now();

  let createdNotes = 0;
  let createdCards = 0;
  let mergedCards = 0;
  let skipped = 0;

  for (const item of items) {
    // 1. Resolve target Deck / Chapter / Book
    let assignedDeckId = targetDeckId || '';

    if (item.book?.trim() || item.chapter?.trim()) {
      const bookName = item.book?.trim() || initialTargetDeck?.book || initialTargetDeck?.name || 'Imported Curriculum';

      // Find or create Book deck (parentId: null)
      let bookDeck = Array.from(deckCache.values()).find(
        (d) => (!d.parentId || d.parentId === null) && d.name.toLowerCase() === bookName.toLowerCase()
      );

      if (!bookDeck) {
        const bookId = uuidv4();
        bookDeck = {
          id: bookId,
          name: bookName,
          parentId: null,
          path: bookName,
          book: bookName,
          language: initialTargetDeck?.language || detectLanguage(item.character),
          newCardsPerDay: 20,
          reviewsPerDay: 200,
          generateTwinCards: true,
          reviewOrder: 'dueFirst',
          updatedAt: now,
        };
        await db.decks.put(bookDeck);
        deckCache.set(bookId, bookDeck);
      }

      // If chapter is specified, find or create Chapter deck under Book (parentId: bookDeck.id)
      if (item.chapter?.trim()) {
        const chapterName = item.chapter.trim();
        let chapterDeck = Array.from(deckCache.values()).find(
          (d) => d.parentId === bookDeck!.id && d.name.toLowerCase() === chapterName.toLowerCase()
        );

        if (!chapterDeck) {
          const chapterId = uuidv4();
          chapterDeck = {
            id: chapterId,
            name: chapterName,
            parentId: bookDeck.id,
            path: `${bookDeck.path}/${chapterName}`,
            book: bookName,
            chapter: chapterName,
            language: bookDeck.language,
            newCardsPerDay: 20,
            reviewsPerDay: 200,
            generateTwinCards: true,
            reviewOrder: 'dueFirst',
            updatedAt: now,
          };
          await db.decks.put(chapterDeck);
          deckCache.set(chapterId, chapterDeck);
        }
        assignedDeckId = chapterDeck.id;
      } else {
        assignedDeckId = bookDeck.id;
      }
    } else if (!assignedDeckId) {
      // No book/chapter and no targetDeckId passed: find or create "Imported Cards" root deck
      let fallbackDeck = Array.from(deckCache.values()).find(
        (d) => (!d.parentId || d.parentId === null) && (d.name === 'Imported Cards' || d.name === 'Default Deck')
      );
      if (!fallbackDeck) {
        assignedDeckId = uuidv4();
        fallbackDeck = {
          id: assignedDeckId,
          name: 'Imported Cards',
          parentId: null,
          path: 'Imported Cards',
          book: 'Imported Cards',
          language: detectLanguage(item.character),
          newCardsPerDay: 20,
          reviewsPerDay: 200,
          generateTwinCards: true,
          reviewOrder: 'dueFirst',
          updatedAt: now,
        };
        await db.decks.put(fallbackDeck);
        deckCache.set(assignedDeckId, fallbackDeck);
      } else {
        assignedDeckId = fallbackDeck.id;
      }
    }

    const assignedDeck = deckCache.get(assignedDeckId);

    // 2. Duplicate Detection
    const readingKey = item.reading || '';
    const existingNote = await db.notes
      .where('[character+reading]')
      .equals([item.character, readingKey])
      .first();

    const isDuplicate = existingNote && (!existingNote.deletedAt || existingNote.deletedAt === 0);

    if (isDuplicate) {
      if (duplicateStrategy === 'skip') {
        skipped++;
        continue;
      }

      if (duplicateStrategy === 'merge') {
        // Merge tags into existing note
        const existingTags = new Set(existingNote.tags || []);
        if (item.tags) {
          item.tags.forEach((t) => existingTags.add(t));
        }
        existingNote.tags = Array.from(existingTags);
        existingNote.updatedAt = now;
        await db.notes.put(existingNote);

        // Find existing cards and append assignedDeckId to secondaryDeckIds
        const existingCards = await db.cards.where('noteId').equals(existingNote.id).toArray();
        for (const card of existingCards) {
          if (card.deckId !== assignedDeckId) {
            const secondary = new Set(card.secondaryDeckIds || []);
            secondary.add(assignedDeckId);
            card.secondaryDeckIds = Array.from(secondary);
            card.updatedAt = now;
            await db.cards.put(card);
          }
        }
        mergedCards++;
        continue;
      }
    }

    // 3. Create NoteRecord
    const noteId = uuidv4();
    const noteRecord: NoteRecord = {
      id: noteId,
      character: item.character,
      reading: item.reading || '',
      meaning: item.meaning,
      exampleSentence: item.exampleSentence,
      notes: item.notes,
      tags: item.tags || [],
      pitchOrTone: item.pitchOrTone,
      radicals: item.radicals,
      updatedAt: now,
    };
    await db.notes.put(noteRecord);
    createdNotes++;

    // 4. Primary Card: Recognition (Character -> Meaning)
    const primaryCardId = uuidv4();
    const primaryCard: CardRecord = {
      id: primaryCardId,
      noteId,
      deckId: assignedDeckId,
      direction: 'recognition',
      due: now,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: 0, // New
      isSuspended: false,
      isLeech: false,
      updatedAt: now,
    };
    await db.cards.put(primaryCard);
    createdCards++;

    // 5. Twin Card: Production (Meaning -> Character)
    if (assignedDeck?.generateTwinCards !== false) {
      const twinCardId = uuidv4();
      const twinCard: CardRecord = {
        id: twinCardId,
        noteId,
        deckId: assignedDeckId,
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
      createdCards++;
    }
  }

  return {
    totalProcessed: items.length,
    createdNotes,
    createdCards,
    mergedCards,
    skipped,
  };
}

/**
 * Recursively fetches all descendant deck IDs for a given root deck ID.
 */
export async function getDescendantDeckIds(rootDeckId: string): Promise<string[]> {
  const allDecks = await db.decks.toArray();
  const result: string[] = [rootDeckId];

  const findChildren = (parentId: string) => {
    const children = allDecks.filter((d) => d.parentId === parentId && (!d.deletedAt || d.deletedAt === 0));
    for (const child of children) {
      result.push(child.id);
      findChildren(child.id);
    }
  };

  findChildren(rootDeckId);
  return result;
}

/**
 * Exports cards belonging to a deck (and optionally its descendants) to CSV.
 */
export async function exportDeckToCSV(deckId: string, includeDescendants: boolean = true): Promise<string> {
  const deckIds = includeDescendants ? await getDescendantDeckIds(deckId) : [deckId];
  const cards = await db.cards
    .filter((c) => (!c.deletedAt || c.deletedAt === 0) && (deckIds.includes(c.deckId) || (c.secondaryDeckIds?.some((id) => deckIds.includes(id)) ?? false)))
    .toArray();

  const noteIds = Array.from(new Set(cards.map((c) => c.noteId)));
  const notes = await db.notes.where('id').anyOf(noteIds).toArray();
  const validNotes = notes.filter((n) => !n.deletedAt || n.deletedAt === 0);

  const escapeCSV = (str?: string) => {
    if (!str) return '""';
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const header = ['Character', 'Reading', 'Meaning', 'Example Sentence', 'Notes', 'Tags'].join(',');
  const rows = validNotes.map((note) => {
    return [
      escapeCSV(note.character),
      escapeCSV(note.reading),
      escapeCSV(note.meaning),
      escapeCSV(note.exampleSentence),
      escapeCSV(note.notes),
      escapeCSV(note.tags?.join(' ')),
    ].join(',');
  });

  return [header, ...rows].join('\n');
}

/**
 * Exports cards belonging to a deck to TSV.
 */
export async function exportDeckToTSV(deckId: string, includeDescendants: boolean = true): Promise<string> {
  const deckIds = includeDescendants ? await getDescendantDeckIds(deckId) : [deckId];
  const cards = await db.cards
    .filter((c) => (!c.deletedAt || c.deletedAt === 0) && (deckIds.includes(c.deckId) || (c.secondaryDeckIds?.some((id) => deckIds.includes(id)) ?? false)))
    .toArray();

  const noteIds = Array.from(new Set(cards.map((c) => c.noteId)));
  const notes = await db.notes.where('id').anyOf(noteIds).toArray();
  const validNotes = notes.filter((n) => !n.deletedAt || n.deletedAt === 0);

  const clean = (str?: string) => (str ? str.replace(/\t/g, ' ').replace(/\r?\n/g, ' ') : '');
  const header = ['Character', 'Reading', 'Meaning', 'Example Sentence', 'Notes', 'Tags'].join('\t');
  const rows = validNotes.map((note) => {
    return [
      clean(note.character),
      clean(note.reading),
      clean(note.meaning),
      clean(note.exampleSentence),
      clean(note.notes),
      clean(note.tags?.join(' ')),
    ].join('\t');
  });

  return [header, ...rows].join('\n');
}

/**
 * Exports cards belonging to a deck to Markdown Quick-Paste format:
 * "食べる(たべる) :: To eat // 毎日りんごを食べます (Daily note) #verb"
 */
export async function exportDeckToMarkdown(deckId: string, includeDescendants: boolean = true): Promise<string> {
  const deckIds = includeDescendants ? await getDescendantDeckIds(deckId) : [deckId];
  const cards = await db.cards
    .filter((c) => (!c.deletedAt || c.deletedAt === 0) && (deckIds.includes(c.deckId) || (c.secondaryDeckIds?.some((id) => deckIds.includes(id)) ?? false)))
    .toArray();

  const noteIds = Array.from(new Set(cards.map((c) => c.noteId)));
  const notes = await db.notes.where('id').anyOf(noteIds).toArray();
  const validNotes = notes.filter((n) => !n.deletedAt || n.deletedAt === 0);

  const lines = validNotes.map((note) => {
    const readingPart = note.reading ? `(${note.reading})` : '';
    const meaningPart = note.meaning;
    const examplePart = note.exampleSentence ? ` // ${note.exampleSentence}` : '';
    const notePart = note.notes ? ` (${note.notes})` : '';
    const tagPart = note.tags && note.tags.length > 0 ? ` ${note.tags.map((t) => `#${t}`).join(' ')}` : '';

    return `${note.character}${readingPart} :: ${meaningPart}${examplePart}${notePart}${tagPart}`;
  });

  return lines.join('\n');
}
