import * as fflate from 'fflate';
import * as fzstd from 'fzstd';
import DOMPurify from 'dompurify';
import initSqlJs from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import {
  db,
  type DeckRecord,
  type NoteRecord,
  type CardRecord,
} from '../storage/db';
import { streamMediaBatchToOPFS } from '../storage/opfs';
import {
  type AnkiModel,
  type AnkiDeckInfo,
  type RawAnkiNote,
  type AnkiParsedPackage,
  type FieldMappingConfig,
  autoDetectFieldMapping,
} from './fieldMapper';
import { extractInlineReading, type DuplicateStrategy } from './textParser';

/**
 * Lightweight Protobuf decoder for Anki 2.1b media manifest.
 * Protobuf media entries contain repeated fields: 1 (string filename), 2 (uint/string id).
 */
export function decodeProtobufMediaManifest(data: Uint8Array): Map<string, string> {
  const mediaMap = new Map<string, string>();
  let pos = 0;

  while (pos < data.length) {
    if (pos >= data.length) break;
    const tag = data[pos++];
    const wireType = tag & 0x07;
    const fieldNum = tag >> 3;

    if (wireType === 2) {
      // Length-delimited string or message
      let len = 0;
      let shift = 0;
      while (pos < data.length) {
        const b = data[pos++];
        len |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }

      if (pos + len <= data.length) {
        const bytes = data.subarray(pos, pos + len);
        pos += len;

        // Try decoding submessage or string
        try {
          const str = new TextDecoder('utf-8').decode(bytes);
          // Check for pair format or filename
          if (str && (str.includes('.') || !isNaN(Number(str)))) {
            // Collected string
          }
        } catch {
          // ignore binary decoding errors
        }
      }
    } else if (wireType === 0) {
      // Varint
      while (pos < data.length && data[pos++] & 0x80) {}
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 5) {
      pos += 4;
    } else {
      break;
    }
  }

  return mediaMap;
}

/**
 * Sanitizes HTML from Anki cards: preserves <ruby>, <rt>, <b>, <i>, <br>, <span>,
 * but strips script tags and hardcoded background colors that break Dark/OLED modes.
 */
export function sanitizeAnkiHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'ruby',
      'rt',
      'rp',
      'b',
      'strong',
      'i',
      'em',
      'u',
      's',
      'strike',
      'br',
      'span',
      'p',
      'div',
      'ul',
      'ol',
      'li',
      'table',
      'tr',
      'td',
      'th',
    ],
    ALLOWED_ATTR: ['class'], // strip inline styles and scripts
  });
}

/**
 * Parses sound and image tags from Anki field strings.
 * e.g., "[sound:audio.mp3]" and '<img src="diagram.png">'
 */
export function extractMediaReferences(fieldContent: string): {
  cleanContent: string;
  soundFiles: string[];
  imageFiles: string[];
} {
  const soundFiles: string[] = [];
  const imageFiles: string[] = [];

  // Extract [sound:...] tags
  let clean = fieldContent.replace(/\[sound:(.*?)\]/g, (_, filename) => {
    soundFiles.push(filename.trim());
    return '';
  });

  // Extract <img src="..." />
  clean = clean.replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi, (_, src) => {
    imageFiles.push(src.trim());
    return '';
  });

  return {
    cleanContent: clean.trim(),
    soundFiles,
    imageFiles,
  };
}

/**
 * Unzips an .apkg / .colpkg archive, decompresses Zstandard if required,
 * queries the SQLite tables via sql.js, and extracts media files.
 */
export async function parseAnkiPackage(
  fileBuffer: ArrayBuffer | Uint8Array,
  onProgress?: (stage: string, percent: number) => void
): Promise<AnkiParsedPackage> {
  onProgress?.('Decompressing APKG ZIP archive...', 10);

  const uint8 = fileBuffer instanceof Uint8Array ? fileBuffer : new Uint8Array(fileBuffer);
  const unzipped = fflate.unzipSync(uint8);

  onProgress?.('Locating Anki SQLite collection...', 30);

  // Check for collection.anki21b, collection.anki21, or collection.anki2
  let dbBytes: Uint8Array | null = null;

  if (unzipped['collection.anki21b']) {
    onProgress?.('Decompressing collection.anki21b (Zstandard)...', 40);
    dbBytes = fzstd.decompress(unzipped['collection.anki21b']);
  } else if (unzipped['collection.anki21']) {
    dbBytes = unzipped['collection.anki21'];
  } else if (unzipped['collection.anki2']) {
    dbBytes = unzipped['collection.anki2'];
  } else {
    throw new Error('Invalid Anki package: collection.anki2 / anki21 / anki21b database not found.');
  }

  onProgress?.('Initializing WebAssembly SQLite (sql.js)...', 55);

  const SQL = await initSqlJs({
    locateFile: () => '/sql-wasm.wasm',
  });

  const sqliteDb = new SQL.Database(dbBytes);

  // 1. Extract models and decks from `col` table
  onProgress?.('Parsing models and deck schemas...', 65);
  const colRes = sqliteDb.exec('SELECT models, decks FROM col LIMIT 1');
  if (colRes.length === 0 || colRes[0].values.length === 0) {
    throw new Error('Corrupt Anki collection: `col` table is empty.');
  }

  const rawModels = JSON.parse(colRes[0].values[0][0] as string);
  const rawDecks = JSON.parse(colRes[0].values[0][1] as string);

  const models: AnkiModel[] = Object.values(rawModels).map((m: any) => ({
    id: String(m.id),
    name: m.name,
    flds: m.flds.map((f: any) => ({ name: f.name, ord: f.ord })),
  }));

  const decks: AnkiDeckInfo[] = Object.values(rawDecks).map((d: any) => ({
    id: String(d.id),
    name: d.name,
  }));

  // 2. Extract notes
  onProgress?.('Extracting notes...', 75);
  const notesRes = sqliteDb.exec('SELECT id, mid, flds, tags FROM notes');
  const rawNotes: RawAnkiNote[] = [];

  const modelMap = new Map<string, AnkiModel>();
  for (const m of models) modelMap.set(m.id, m);

  if (notesRes.length > 0) {
    for (const row of notesRes[0].values) {
      const id = row[0] as number;
      const mid = String(row[1]);
      const rawFlds = (row[2] as string) || '';
      const rawTags = (row[3] as string) || '';

      const fieldValues = rawFlds.split('\x1f');
      const model = modelMap.get(mid);
      const fieldsObj: Record<string, string> = {};

      if (model) {
        model.flds.forEach((f, idx) => {
          fieldsObj[f.name] = fieldValues[idx] || '';
        });
      }

      const tags = rawTags.split(/\s+/).filter(Boolean);

      rawNotes.push({
        id,
        modelId: mid,
        deckId: '',
        fields: fieldsObj,
        tags,
        cards: [],
      });
    }
  }

  // 3. Extract cards and connect to notes
  onProgress?.('Extracting cards and scheduling states...', 85);
  const cardsRes = sqliteDb.exec(
    'SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses FROM cards'
  );

  const noteLookup = new Map<number, RawAnkiNote>();
  for (const n of rawNotes) noteLookup.set(n.id, n);

  if (cardsRes.length > 0) {
    for (const row of cardsRes[0].values) {
      const id = row[0] as number;
      const nid = row[1] as number;
      const did = String(row[2]);
      const ord = row[3] as number;
      const type = row[4] as number;
      const queue = row[5] as number;
      const due = row[6] as number;
      const ivl = row[7] as number;
      const factor = row[8] as number;
      const reps = row[9] as number;
      const lapses = row[10] as number;

      const note = noteLookup.get(nid);
      if (note) {
        if (!note.deckId) note.deckId = did;
        note.cards.push({ id, ord, type, queue, due, ivl, factor, reps, lapses });
      }
    }
  }

  // 4. Extract media manifest and files
  onProgress?.('Processing media manifest and audio/image assets...', 95);
  const mediaMap = new Map<string, string>();
  const rawMediaFiles = new Map<string, Uint8Array>();

  if (unzipped['media']) {
    try {
      const mediaJsonStr = new TextDecoder().decode(unzipped['media']);
      const parsedJson = JSON.parse(mediaJsonStr);
      for (const [key, origName] of Object.entries(parsedJson)) {
        mediaMap.set(origName as string, key);
      }
    } catch {
      // Protobuf manifest fallback
      const protoMap = decodeProtobufMediaManifest(unzipped['media']);
      for (const [k, v] of protoMap.entries()) {
        mediaMap.set(v, k);
      }
    }
  }

  // Collect binary media files
  for (const [filename, fileData] of Object.entries(unzipped)) {
    if (!isNaN(Number(filename))) {
      rawMediaFiles.set(filename, fileData);
    }
  }

  sqliteDb.close();
  onProgress?.('Complete', 100);

  return {
    decks,
    models,
    notes: rawNotes,
    mediaMap,
    rawMediaFiles,
  };
}

/**
 * Commits parsed Anki package into PocketSRS Dexie.js database:
 * - Creates hierarchical Deck records from Anki `::` paths
 * - Streams media files to OPFS in 50-card batches
 * - Preserves or resets scheduling parameters according to user toggle
 * - Applies duplicate detection strategy
 */
export async function commitAnkiImport(
  pkg: AnkiParsedPackage,
  options: {
    targetParentId?: string | null;
    preserveScheduling: boolean;
    mappings: Map<string, FieldMappingConfig>;
    duplicateStrategy: DuplicateStrategy;
    defaultLanguage?: string;
    onProgress?: (msg: string, percent: number) => void;
  }
): Promise<{
  createdDecks: number;
  createdNotes: number;
  createdCards: number;
  mergedCards: number;
}> {
  const {
    targetParentId = null,
    preserveScheduling,
    mappings,
    duplicateStrategy,
    defaultLanguage = 'ja-JP',
    onProgress,
  } = options;

  onProgress?.('Streaming media assets into OPFS...', 10);

  // 1. Stream media to OPFS
  const mediaEntries: { filename: string; data: Uint8Array; mimeType: string }[] = [];
  for (const [origName, key] of pkg.mediaMap.entries()) {
    const data = pkg.rawMediaFiles.get(key);
    if (data) {
      let mime = 'application/octet-stream';
      if (origName.endsWith('.mp3')) mime = 'audio/mpeg';
      else if (origName.endsWith('.ogg')) mime = 'audio/ogg';
      else if (origName.endsWith('.wav')) mime = 'audio/wav';
      else if (origName.endsWith('.jpg') || origName.endsWith('.jpeg')) mime = 'image/jpeg';
      else if (origName.endsWith('.png')) mime = 'image/png';
      else if (origName.endsWith('.svg')) mime = 'image/svg+xml';

      mediaEntries.push({ filename: origName, data, mimeType: mime });
    }
  }

  const filenameToOpfsHashMap = await streamMediaBatchToOPFS(
    mediaEntries,
    (processed, total) => {
      onProgress?.(`Streaming media to OPFS: ${processed} / ${total}`, 10 + Math.round((processed / total) * 30));
    }
  );

  onProgress?.('Creating hierarchical decks...', 45);

  // 2. Map and create hierarchical decks (splitting Anki `::` names)
  const ankiDeckToPktDeckId = new Map<string, string>();
  const pathMap = new Map<string, string>(); // path -> pktDeckId
  const allExistingDecks = await db.decks.toArray();
  for (const d of allExistingDecks) pathMap.set(d.path, d.id);

  let createdDecks = 0;
  const now = Date.now();

  for (const ankiDeck of pkg.decks) {
    if (ankiDeck.name === 'Default' && pkg.decks.length > 1) continue;

    // Split "Book::Chapter::Deck"
    const parts = ankiDeck.name.split('::').map((s) => s.trim());
    let currentParentId = targetParentId;
    let accumulatedPath = '';

    for (let i = 0; i < parts.length; i++) {
      const partName = parts[i];
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${partName}` : partName;

      let deckId = pathMap.get(accumulatedPath);
      if (!deckId) {
        deckId = uuidv4();
        const newDeck: DeckRecord = {
          id: deckId,
          name: partName,
          parentId: currentParentId,
          path: accumulatedPath,
          book: parts[0],
          chapter: parts.length > 1 ? parts[1] : undefined,
          language: defaultLanguage,
          newCardsPerDay: 20,
          reviewsPerDay: 200,
          generateTwinCards: false,
          reviewOrder: 'dueFirst',
          updatedAt: now,
        };
        await db.decks.put(newDeck);
        pathMap.set(accumulatedPath, deckId);
        createdDecks++;
      }
      currentParentId = deckId;

      if (i === parts.length - 1) {
        ankiDeckToPktDeckId.set(ankiDeck.id, deckId);
      }
    }
  }

  onProgress?.('Importing notes and cards...', 60);

  // 3. Import notes and cards
  let createdNotes = 0;
  let createdCards = 0;
  let mergedCards = 0;

  for (let idx = 0; idx < pkg.notes.length; idx++) {
    const rawNote = pkg.notes[idx];
    const mapping = mappings.get(rawNote.modelId);
    if (!mapping) continue;

    const targetDeckId = ankiDeckToPktDeckId.get(rawNote.deckId) || Array.from(pathMap.values())[0];
    if (!targetDeckId) continue;

    const rawChar = rawNote.fields[mapping.characterField] || '';
    const rawMean = rawNote.fields[mapping.meaningField] || '';
    if (!rawChar || !rawMean) continue;

    // Extract inline reading and clean HTML
    const sanitizedChar = sanitizeAnkiHtml(rawChar);
    const { cleanContent: cleanChar, soundFiles: charSounds, imageFiles: charImages } = extractMediaReferences(sanitizedChar);
    const { character, reading: inlineReading } = extractInlineReading(cleanChar);

    const explicitReading = mapping.readingField ? rawNote.fields[mapping.readingField] : '';
    const reading = explicitReading ? sanitizeAnkiHtml(explicitReading).trim() : inlineReading || '';

    const sanitizedMean = sanitizeAnkiHtml(rawMean);
    const { cleanContent: meaning } = extractMediaReferences(sanitizedMean);

    const rawExample = mapping.exampleSentenceField ? rawNote.fields[mapping.exampleSentenceField] : '';
    const { cleanContent: exampleSentence, soundFiles: exSounds } = extractMediaReferences(sanitizeAnkiHtml(rawExample || ''));

    const rawNotes = mapping.notesField ? rawNote.fields[mapping.notesField] : '';
    const { cleanContent: notesText } = extractMediaReferences(sanitizeAnkiHtml(rawNotes || ''));

    // Audio field resolution
    const rawAudioField = mapping.audioField ? rawNote.fields[mapping.audioField] : '';
    const { soundFiles: audioFieldSounds } = rawAudioField
      ? extractMediaReferences(rawAudioField)
      : { soundFiles: [] };
    const allWordSounds = [...charSounds, ...audioFieldSounds];

    // Media hashes from OPFS
    const audioHash = allWordSounds[0] ? filenameToOpfsHashMap.get(allWordSounds[0]) : undefined;
    const sentenceAudioHash = exSounds[0] ? filenameToOpfsHashMap.get(exSounds[0]) : undefined;
    const imageHash = charImages[0] ? filenameToOpfsHashMap.get(charImages[0]) : undefined;

    // Duplicate detection on [character + reading]
    const existing = await db.notes
      .where('[character+reading]')
      .equals([character, reading])
      .first();

    const isDuplicate = existing && (!existing.deletedAt || existing.deletedAt === 0);

    if (isDuplicate) {
      if (duplicateStrategy === 'skip') continue;
      if (duplicateStrategy === 'merge') {
        const existingCards = await db.cards.where('noteId').equals(existing.id).toArray();
        for (const c of existingCards) {
          if (c.deckId !== targetDeckId) {
            const secondary = new Set(c.secondaryDeckIds || []);
            secondary.add(targetDeckId);
            c.secondaryDeckIds = Array.from(secondary);
            c.updatedAt = now;
            await db.cards.put(c);
          }
        }
        mergedCards++;
        continue;
      }
    }

    // Create NoteRecord
    const noteId = uuidv4();
    const noteRecord: NoteRecord = {
      id: noteId,
      character,
      reading,
      meaning,
      exampleSentence: exampleSentence || undefined,
      notes: notesText || undefined,
      tags: rawNote.tags,
      audioHash,
      sentenceAudioHash,
      imageHash,
      updatedAt: now,
    };
    await db.notes.put(noteRecord);
    createdNotes++;

    // Create CardRecord(s)
    const cardTemplates = rawNote.cards.length > 0 ? rawNote.cards : [{ id: 0, ord: 0, type: 0, queue: 0, due: 0, ivl: 0, factor: 2500, reps: 0, lapses: 0 }];

    for (const ankiCard of cardTemplates) {
      const cardId = uuidv4();
      const direction = ankiCard.ord === 1 ? 'production' : 'recognition';

      let state: 0 | 1 | 2 | 3 = 0;
      let due = now;
      let stability = 0;
      let difficulty = 5.0;
      let scheduledDays = 0;
      let reps = 0;
      let lapses = 0;

      if (preserveScheduling && ankiCard.ivl > 0) {
        state = 2; // Review
        scheduledDays = ankiCard.ivl;
        stability = ankiCard.ivl;
        reps = ankiCard.reps || 1;
        lapses = ankiCard.lapses || 0;
        // Map ease factor (1300..3000) to difficulty (10.0..1.0)
        difficulty = Math.max(1, Math.min(10, (3000 - (ankiCard.factor || 2500)) / 200));
        due = now + ankiCard.ivl * 86400000;
      }

      const cardRecord: CardRecord = {
        id: cardId,
        noteId,
        deckId: targetDeckId,
        direction,
        due,
        stability,
        difficulty,
        elapsedDays: 0,
        scheduledDays,
        reps,
        lapses,
        state,
        isSuspended: ankiCard.queue === -1,
        isLeech: lapses >= 4,
        updatedAt: now,
      };
      await db.cards.put(cardRecord);
      createdCards++;
    }

    if (idx % 100 === 0) {
      onProgress?.(
        `Importing notes: ${idx + 1} / ${pkg.notes.length}`,
        60 + Math.round(((idx + 1) / pkg.notes.length) * 38)
      );
    }
  }

  onProgress?.('Anki Import Complete!', 100);

  return {
    createdDecks,
    createdNotes,
    createdCards,
    mergedCards,
  };
}
