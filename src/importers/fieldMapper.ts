export interface AnkiModelField {
  name: string;
  ord: number;
}

export interface AnkiModel {
  id: string;
  name: string;
  flds: AnkiModelField[];
}

export interface AnkiDeckInfo {
  id: string;
  name: string;
}

export interface FieldMappingConfig {
  modelId: string;
  modelName: string;
  characterField: string;
  readingField?: string;
  meaningField: string;
  audioField?: string;
  exampleSentenceField?: string;
  notesField?: string;
  tagsField?: string;
}

export interface RawAnkiNote {
  id: number;
  modelId: string;
  deckId: string;
  fields: Record<string, string>;
  tags: string[];
  cards: {
    id: number;
    ord: number;
    type: number;
    queue: number;
    due: number;
    ivl: number;
    factor: number;
    reps: number;
    lapses: number;
  }[];
}

export interface AnkiParsedPackage {
  decks: AnkiDeckInfo[];
  models: AnkiModel[];
  notes: RawAnkiNote[];
  mediaMap: Map<string, string>; // originalFilename -> mediaKey (e.g. '0', '1')
  rawMediaFiles: Map<string, Uint8Array>; // mediaKey -> binary data
}

/**
 * Intelligent heuristics to auto-map Anki model fields to PocketSRS slots using weighted scoring.
 */
export function autoDetectFieldMapping(model: AnkiModel): FieldMappingConfig {
  const fieldNames = model.flds.map((f) => f.name);

  const scoreField = (name: string, targets: Record<string, number>, penalties: string[] = []): number => {
    const lower = name.toLowerCase();
    for (const pen of penalties) {
      if (lower.includes(pen)) return -100;
    }
    let score = 0;
    for (const [kw, pts] of Object.entries(targets)) {
      if (lower === kw) score += pts * 2;
      else if (lower.includes(kw)) score += pts;
    }
    return score;
  };

  const bestMatch = (targets: Record<string, number>, penalties: string[] = []): string | undefined => {
    let bestScore = 0;
    let bestName: string | undefined = undefined;
    for (const name of fieldNames) {
      const s = scoreField(name, targets, penalties);
      if (s > bestScore) {
        bestScore = s;
        bestName = name;
      }
    }
    return bestName;
  };

  const characterField =
    bestMatch(
      { kanji: 50, hanzi: 50, character: 40, expression: 30, front: 25, word: 15, vocabulary: 10, term: 10 },
      ['reading', 'kana', 'furigana', 'pinyin', 'audio', 'sound', 'meaning', 'english', 'definition', 'sentence', 'example']
    ) || fieldNames[0] || '';

  const readingField = bestMatch(
    { reading: 50, kana: 50, furigana: 50, pinyin: 40, ipa: 30, pronunciation: 30 },
    ['audio', 'sound', 'meaning', 'english', 'sentence', 'example']
  );

  const meaningField =
    bestMatch(
      { meaning: 50, definition: 45, english: 40, translation: 35, glossary: 30, back: 25 },
      ['reading', 'kana', 'audio', 'sound', 'kanji', 'character', 'sentence']
    ) || (fieldNames.length > 1 ? fieldNames.find((f) => f !== characterField) || fieldNames[1] : fieldNames[0]);

  const audioField =
    bestMatch({ audio: 50, sound: 50, voice: 40 }, ['sentence', 'example', 'context']) ||
    bestMatch({ audio: 50, sound: 40, voice: 30 });

  const exampleSentenceField =
    bestMatch({ sentence: 50, example: 45, context: 30 }, ['audio', 'sound', 'translation']) ||
    bestMatch({ sentence: 50, example: 45 });

  const notesField = bestMatch({ note: 50, notes: 50, mnemonic: 45, hint: 40, comment: 30, extra: 25 });

  return {
    modelId: model.id,
    modelName: model.name,
    characterField,
    readingField,
    meaningField,
    audioField,
    exampleSentenceField,
    notesField,
  };
}
