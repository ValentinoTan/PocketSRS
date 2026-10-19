import React, { useState } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  Code,
  FileText,
  Sparkles,
  AlertTriangle,
  FolderTree,
  Clock,
  Layers,
  CheckCircle2,
} from 'lucide-react';
import {
  parseMarkdownQuickPaste,
  parseDelimitedText,
  parseJsonText,
  inspectDuplicates,
  importParsedItems,
  type DuplicateStrategy,
  type ImportPreviewItem,
} from '../importers/textParser';
import {
  type AnkiParsedPackage,
  type FieldMappingConfig,
  autoDetectFieldMapping,
} from '../importers/fieldMapper';
import { commitAnkiImport, parseAnkiPackage } from '../importers/apkgParser';
import { type DeckRecord } from '../storage/db';

export type ImportTab = 'delimited' | 'json' | 'markdown' | 'anki';

interface ImportModalProps {
  targetDeck?: DeckRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (summary: string) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  targetDeck,
  isOpen,
  onClose,
  onImportComplete,
}) => {
  // Tab state
  const [activeTab, setActiveTab] = useState<ImportTab>('delimited');

  // Text/CSV state
  const [inputText, setInputText] = useState('');
  const [delimiter, setDelimiter] = useState<string>(',');
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>('merge');
  const [previewItems, setPreviewItems] = useState<ImportPreviewItem[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [textImporting, setTextImporting] = useState(false);

  // Anki Ingestion state
  const [ankiStage, setAnkiStage] = useState<'upload' | 'mapping' | 'importing'>('upload');
  const [ankiProgressMsg, setAnkiProgressMsg] = useState('');
  const [ankiProgressPercent, setAnkiProgressPercent] = useState(0);
  const [parsedPkg, setParsedPkg] = useState<AnkiParsedPackage | null>(null);
  const [mappings, setMappings] = useState<Map<string, FieldMappingConfig>>(new Map());
  const [preserveScheduling, setPreserveScheduling] = useState(true);
  const [defaultLanguage, setDefaultLanguage] = useState('ja-JP');

  // Drag-and-drop state
  const [isDragging, setIsDragging] = useState(false);

  if (!isOpen) return null;

  const handleResetAndClose = () => {
    setInputText('');
    setPreviewItems(null);
    setParsedPkg(null);
    setAnkiStage('upload');
    setAnkiProgressPercent(0);
    setAnkiProgressMsg('');
    setActiveTab('delimited');
    onClose();
  };

  // Inspect duplicates for parsed text items
  const runPreviewInspection = async (items: any[]) => {
    setAnalyzing(true);
    try {
      const inspected = await inspectDuplicates(items);
      setPreviewItems(inspected);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleManualAnalyze = async () => {
    if (!inputText.trim()) return;

    let parsed = [];
    if (activeTab === 'markdown') {
      parsed = parseMarkdownQuickPaste(inputText);
    } else if (activeTab === 'json') {
      parsed = parseJsonText(inputText);
    } else {
      parsed = parseDelimitedText(inputText, delimiter);
    }

    if (parsed.length > 0) {
      await runPreviewInspection(parsed);
    }
  };

  // Execute CSV / JSON / Markdown Import
  const handleExecuteTextImport = async () => {
    if (!previewItems || previewItems.length === 0) return;

    setTextImporting(true);
    try {
      const itemsToImport = previewItems.map((p) => p.item);
      const result = await importParsedItems(itemsToImport, targetDeck?.id || null, duplicateStrategy);
      onImportComplete(
        `Successfully imported ${result.createdCards} cards (${result.createdNotes} notes, ${result.mergedCards} merged, ${result.skipped} skipped)!`
      );
      handleResetAndClose();
    } finally {
      setTextImporting(false);
    }
  };

  // Start Anki Package Ingestion (spawns Web Worker with direct fallback)
  const startAnkiIngestion = async (file: File) => {
    setAnkiStage('upload');
    setAnkiProgressMsg('Reading APKG archive file...');
    setAnkiProgressPercent(5);

    const buffer = await file.arrayBuffer();

    try {
      const worker = new Worker(new URL('../importers/apkgWorker.ts', import.meta.url), {
        type: 'module',
      });

      worker.onmessage = (event) => {
        const { type, stage: pStage, percent, pkg } = event.data;
        if (type === 'PROGRESS') {
          setAnkiProgressMsg(pStage);
          setAnkiProgressPercent(percent);
        } else if (type === 'SUCCESS') {
          worker.terminate();
          onAnkiPackageParsed(pkg);
        } else if (type === 'ERROR') {
          worker.terminate();
          parseAnkiPackage(buffer, (s, p) => {
            setAnkiProgressMsg(s);
            setAnkiProgressPercent(p);
          })
            .then(onAnkiPackageParsed)
            .catch((err) => {
              alert('Error importing Anki package: ' + (err?.message || err));
              setAnkiStage('upload');
              setAnkiProgressPercent(0);
            });
        }
      };

      worker.postMessage({ type: 'PARSE_APKG', fileBuffer: buffer });
    } catch {
      parseAnkiPackage(buffer, (s, p) => {
        setAnkiProgressMsg(s);
        setAnkiProgressPercent(p);
      })
        .then(onAnkiPackageParsed)
        .catch((err) => {
          alert('Error importing Anki package: ' + (err?.message || err));
          setAnkiStage('upload');
          setAnkiProgressPercent(0);
        });
    }
  };

  const onAnkiPackageParsed = (pkg: AnkiParsedPackage) => {
    setParsedPkg(pkg);
    const newMappings = new Map<string, FieldMappingConfig>();
    for (const m of pkg.models) {
      newMappings.set(m.id, autoDetectFieldMapping(m));
    }
    setMappings(newMappings);
    setAnkiStage('mapping');
    setAnkiProgressPercent(0);
  };

  // Commit Anki Import to FSRS
  const handleCommitAnki = async () => {
    if (!parsedPkg) return;

    setAnkiStage('importing');
    setAnkiProgressPercent(10);
    setAnkiProgressMsg('Beginning database commit...');

    try {
      const result = await commitAnkiImport(parsedPkg, {
        targetParentId: targetDeck?.id || null,
        preserveScheduling,
        mappings,
        duplicateStrategy,
        defaultLanguage,
        onProgress: (msg, percent) => {
          setAnkiProgressMsg(msg);
          setAnkiProgressPercent(percent);
        },
      });

      onImportComplete(
        `Successfully imported ${result.createdDecks} decks, ${result.createdNotes} notes, and ${result.createdCards} cards (${result.mergedCards} merged)!`
      );
      handleResetAndClose();
    } catch (err: any) {
      alert('Import failed: ' + (err?.message || err));
      setAnkiStage('mapping');
    }
  };

  const updateMapping = (modelId: string, updates: Partial<FieldMappingConfig>) => {
    const current = mappings.get(modelId);
    if (!current) return;
    const nextMap = new Map(mappings);
    nextMap.set(modelId, { ...current, ...updates });
    setMappings(nextMap);
  };

  // Smart Auto-Detection on File Upload or Drop
  const handleProcessFile = async (file: File) => {
    const fileName = file.name.toLowerCase();

    // 1. Anki Package (.apkg / .colpkg)
    if (fileName.endsWith('.apkg') || fileName.endsWith('.colpkg')) {
      setActiveTab('anki');
      await startAnkiIngestion(file);
      return;
    }

    // 2. JSON Dataset (.json)
    if (fileName.endsWith('.json')) {
      setActiveTab('json');
      const text = await file.text();
      setInputText(text);
      const parsed = parseJsonText(text);
      if (parsed.length > 0) {
        await runPreviewInspection(parsed);
      }
      return;
    }

    // 3. TSV Spreadsheet (.tsv)
    if (fileName.endsWith('.tsv')) {
      setActiveTab('delimited');
      setDelimiter('\t');
      const text = await file.text();
      setInputText(text);
      const parsed = parseDelimitedText(text, '\t');
      if (parsed.length > 0) {
        await runPreviewInspection(parsed);
      }
      return;
    }

    // 4. CSV Spreadsheet (.csv)
    if (fileName.endsWith('.csv')) {
      setActiveTab('delimited');
      setDelimiter(',');
      const text = await file.text();
      setInputText(text);
      const parsed = parseDelimitedText(text, ',');
      if (parsed.length > 0) {
        await runPreviewInspection(parsed);
      }
      return;
    }

    // 5. Markdown or TXT (.md / .txt)
    if (fileName.endsWith('.md') || fileName.endsWith('.txt')) {
      const text = await file.text();
      setInputText(text);
      if (text.includes('::')) {
        setActiveTab('markdown');
        const parsed = parseMarkdownQuickPaste(text);
        if (parsed.length > 0) {
          await runPreviewInspection(parsed);
        }
      } else {
        setActiveTab('delimited');
        const parsed = parseDelimitedText(text);
        if (parsed.length > 0) {
          await runPreviewInspection(parsed);
        }
      }
      return;
    }

    // Default fallback
    setActiveTab('delimited');
    const text = await file.text();
    setInputText(text);
    const parsed = parseDelimitedText(text);
    if (parsed.length > 0) {
      await runPreviewInspection(parsed);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleProcessFile(file);
    }
  };

  const sampleCsv = `character,meaning,reading,pitchOrTone,radicals,exampleSentence,notes,tags,book,chapter
食べる,To eat,たべる,,食,毎日りんごを食べます。,Ichidan verb,verb,Minna no Nihongo 1,Chapter 1
飲む,To drink,のむ,,飠,水を飲みます。,Godan verb,verb,Minna no Nihongo 1,Chapter 1
本,Book,ほん,,木,これは私の本です。,Noun,noun,Minna no Nihongo 1,Chapter 2`;

  const sampleJson = `[
  {
    "character": "食べる",
    "reading": "たべる",
    "meaning": "To eat",
    "exampleSentence": "毎日りんごを食べます。",
    "notes": "Ichidan transitive verb",
    "tags": ["verb", "jlpt-n5"],
    "book": "Minna no Nihongo 1",
    "chapter": "Chapter 1"
  }
]`;

  const sampleMarkdown = `食べる(たべる) :: To eat // 毎日りんごを食べます (Daily sentence) #verb #n5
本(ほん) :: Book // これは私の本です #noun
飲む(のむ) :: To drink // 水を飲みます #verb`;

  const duplicateCount = previewItems?.filter((p) => p.status === 'duplicate').length || 0;
  const newCount = previewItems?.filter((p) => p.status === 'new').length || 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <div
        className={`w-full max-w-3xl bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border transition-all overflow-hidden flex flex-col max-h-[90vh] ${
          isDragging
            ? 'border-indigo-500 ring-4 ring-indigo-500/20'
            : 'border-gray-200 dark:border-gray-800'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              <Upload className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                {targetDeck ? (
                  <>
                    Import into{' '}
                    <span className="text-indigo-600 dark:text-indigo-400">{targetDeck.name}</span>
                  </>
                ) : (
                  'Import Cards & Decks'
                )}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Universal Ingestion: CSV, TSV, JSON, Markdown, and Anki packages (.apkg / .colpkg)
              </p>
            </div>
          </div>
          <button
            onClick={handleResetAndClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-sm">
          {/* Top 4 Navigation Tabs */}
          <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
            <button
              type="button"
              onClick={() => {
                setActiveTab('delimited');
                setPreviewItems(null);
              }}
              className={`flex-1 py-2 px-3 rounded-xl border text-center font-semibold transition-all text-xs flex items-center justify-center gap-1.5 ${
                activeTab === 'delimited'
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-950 dark:border-indigo-800 dark:text-indigo-300 shadow-sm'
                  : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>CSV / TSV</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('json');
                setPreviewItems(null);
              }}
              className={`flex-1 py-2 px-3 rounded-xl border text-center font-semibold transition-all text-xs flex items-center justify-center gap-1.5 ${
                activeTab === 'json'
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-950 dark:border-indigo-800 dark:text-indigo-300 shadow-sm'
                  : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>JSON Dataset</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('markdown');
                setPreviewItems(null);
              }}
              className={`flex-1 py-2 px-3 rounded-xl border text-center font-semibold transition-all text-xs flex items-center justify-center gap-1.5 ${
                activeTab === 'markdown'
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-950 dark:border-indigo-800 dark:text-indigo-300 shadow-sm'
                  : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Markdown Quick-Paste</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('anki');
                setPreviewItems(null);
              }}
              className={`flex-1 py-2 px-3 rounded-xl border text-center font-semibold transition-all text-xs flex items-center justify-center gap-1.5 ${
                activeTab === 'anki'
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-950 dark:border-indigo-800 dark:text-indigo-300 shadow-sm'
                  : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              <span>Anki (.apkg / .colpkg)</span>
            </button>
          </div>

          {/* TAB 4: ANKI INGESTION VIEW */}
          {activeTab === 'anki' ? (
            <div className="space-y-5 animate-fadeIn">
              {ankiStage === 'upload' && (
                <div className="space-y-6">
                  {ankiProgressPercent > 0 ? (
                    <div className="py-12 text-center space-y-4">
                      <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                      <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                        {ankiProgressMsg}
                      </div>
                      <div className="w-full max-w-md bg-gray-200 dark:bg-gray-700 h-2 rounded-full overflow-hidden mx-auto">
                        <div
                          className="bg-indigo-600 h-2 transition-all duration-300"
                          style={{ width: `${ankiProgressPercent}%` }}
                        ></div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Drag & Drop Zone */}
                      <div className="p-8 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-3xl text-center flex flex-col items-center justify-center space-y-3 bg-gray-50/50 dark:bg-gray-800/30">
                        <div className="w-14 h-14 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center shadow-md shadow-indigo-500/10">
                          <Sparkles className="w-7 h-7" />
                        </div>
                        <div>
                          <h4 className="font-bold text-gray-900 dark:text-gray-100 text-base">
                            Select Anki Package (.apkg / .colpkg)
                          </h4>
                          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mt-1">
                            Drag and drop your Anki deck file here, or click below. Audio and images stream directly into OPFS.
                          </p>
                        </div>
                        <label className="inline-block px-6 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold cursor-pointer shadow-md shadow-indigo-500/20 transition-all">
                          <span>Choose .apkg File</span>
                          <input
                            type="file"
                            accept=".apkg,.colpkg"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleProcessFile(f);
                            }}
                            className="hidden"
                          />
                        </label>
                      </div>

                      {/* Scheduling Toggle */}
                      <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-3">
                        <div className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-indigo-600" /> Scheduling Progress
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <label
                            className={`p-3.5 rounded-xl border cursor-pointer text-xs flex flex-col justify-between transition-all ${
                              preserveScheduling
                                ? 'border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/30'
                                : 'border-gray-200 dark:border-gray-800'
                            }`}
                          >
                            <div className="flex items-center gap-2 font-bold mb-1">
                              <input
                                type="radio"
                                name="preserveSched"
                                checked={preserveScheduling}
                                onChange={() => setPreserveScheduling(true)}
                                className="text-indigo-600"
                              />
                              <span>Preserve Anki review intervals</span>
                            </div>
                            <span className="text-[11px] text-gray-500">
                              Imports existing review intervals, ease, and review logs into FSRS-6.
                            </span>
                          </label>

                          <label
                            className={`p-3.5 rounded-xl border cursor-pointer text-xs flex flex-col justify-between transition-all ${
                              !preserveScheduling
                                ? 'border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/30'
                                : 'border-gray-200 dark:border-gray-800'
                            }`}
                          >
                            <div className="flex items-center gap-2 font-bold mb-1">
                              <input
                                type="radio"
                                name="preserveSched"
                                checked={!preserveScheduling}
                                onChange={() => setPreserveScheduling(false)}
                                className="text-indigo-600"
                              />
                              <span>Reset as new FSRS cards</span>
                            </div>
                            <span className="text-[11px] text-gray-500">
                              Resets all cards to New (state 0) to learn afresh with FSRS-6.
                            </span>
                          </label>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Anki Field Mapping Stage */}
              {ankiStage === 'mapping' && parsedPkg && (
                <div className="space-y-5 animate-fadeIn">
                  {/* Summary Banner */}
                  <div className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-bold text-indigo-950 dark:text-indigo-200 text-sm">
                        {parsedPkg.notes.length} Notes • {parsedPkg.decks.length} Decks • {parsedPkg.mediaMap.size} Media Assets
                      </div>
                      <div className="text-indigo-700 dark:text-indigo-400 mt-0.5">
                        Select target slots for your custom Anki note models below.
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">Language:</span>
                      <select
                        value={defaultLanguage}
                        onChange={(e) => setDefaultLanguage(e.target.value)}
                        className="px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-semibold"
                      >
                        <option value="ja-JP">Japanese (ja-JP)</option>
                        <option value="zh-CN">Chinese (zh-CN)</option>
                        <option value="ko-KR">Korean (ko-KR)</option>
                        <option value="en-US">English (en-US)</option>
                      </select>
                    </div>
                  </div>

                  {/* Duplicate Strategy Selection */}
                  <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-2">
                    <div className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Duplicate Handling
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="ankiDup"
                          checked={duplicateStrategy === 'merge'}
                          onChange={() => setDuplicateStrategy('merge')}
                        />
                        <span>Merge Chapters (secondaryDeckIds)</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="ankiDup"
                          checked={duplicateStrategy === 'skip'}
                          onChange={() => setDuplicateStrategy('skip')}
                        />
                        <span>Skip Existing</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="ankiDup"
                          checked={duplicateStrategy === 'separate'}
                          onChange={() => setDuplicateStrategy('separate')}
                        />
                        <span>Keep Separate</span>
                      </label>
                    </div>
                  </div>

                  {/* Interactive Field Mappings */}
                  <div className="space-y-4">
                    <h4 className="font-bold text-gray-900 dark:text-gray-100 text-sm">
                      Field Mappings ({parsedPkg.models.length} Note Models)
                    </h4>

                    {parsedPkg.models.map((model) => {
                      const currentMapping = mappings.get(model.id);
                      if (!currentMapping) return null;

                      const sampleNote = parsedPkg.notes.find((n) => n.modelId === model.id);

                      return (
                        <div
                          key={model.id}
                          className="p-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/40 space-y-4"
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                              Model: {model.name}
                            </div>
                            <span className="text-xs text-gray-400">
                              {model.flds.length} fields available
                            </span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                            <div>
                              <label className="block font-semibold text-gray-600 dark:text-gray-400 mb-1">
                                Character / Front <span className="text-red-500">*</span>
                              </label>
                              <select
                                value={currentMapping.characterField}
                                onChange={(e) =>
                                  updateMapping(model.id, { characterField: e.target.value })
                                }
                                className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 font-medium"
                              >
                                {model.flds.map((f) => (
                                  <option key={f.name} value={f.name}>
                                    {f.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block font-semibold text-gray-600 dark:text-gray-400 mb-1">
                                Reading (Furigana / Pinyin)
                              </label>
                              <select
                                value={currentMapping.readingField || ''}
                                onChange={(e) =>
                                  updateMapping(model.id, { readingField: e.target.value || undefined })
                                }
                                className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 font-medium"
                              >
                                <option value="">(None / Inline Extract)</option>
                                {model.flds.map((f) => (
                                  <option key={f.name} value={f.name}>
                                    {f.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block font-semibold text-gray-600 dark:text-gray-400 mb-1">
                                Meaning / Back <span className="text-red-500">*</span>
                              </label>
                              <select
                                value={currentMapping.meaningField}
                                onChange={(e) =>
                                  updateMapping(model.id, { meaningField: e.target.value })
                                }
                                className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 font-medium"
                              >
                                {model.flds.map((f) => (
                                  <option key={f.name} value={f.name}>
                                    {f.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block font-semibold text-gray-600 dark:text-gray-400 mb-1">
                                Audio / Pronunciation
                              </label>
                              <select
                                value={currentMapping.audioField || ''}
                                onChange={(e) =>
                                  updateMapping(model.id, {
                                    audioField: e.target.value || undefined,
                                  })
                                }
                                className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 font-medium"
                              >
                                <option value="">(None / Inline Extract)</option>
                                {model.flds.map((f) => (
                                  <option key={f.name} value={f.name}>
                                    {f.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block font-semibold text-gray-600 dark:text-gray-400 mb-1">
                                Example Sentence
                              </label>
                              <select
                                value={currentMapping.exampleSentenceField || ''}
                                onChange={(e) =>
                                  updateMapping(model.id, {
                                    exampleSentenceField: e.target.value || undefined,
                                  })
                                }
                                className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 font-medium"
                              >
                                <option value="">(None)</option>
                                {model.flds.map((f) => (
                                  <option key={f.name} value={f.name}>
                                    {f.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block font-semibold text-gray-600 dark:text-gray-400 mb-1">
                                Notes / Mnemonics
                              </label>
                              <select
                                value={currentMapping.notesField || ''}
                                onChange={(e) =>
                                  updateMapping(model.id, { notesField: e.target.value || undefined })
                                }
                                className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 font-medium"
                              >
                                <option value="">(None)</option>
                                {model.flds.map((f) => (
                                  <option key={f.name} value={f.name}>
                                    {f.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {sampleNote && (
                            <div className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-xs space-y-1">
                              <span className="font-semibold text-gray-400 uppercase text-[10px] tracking-wider">
                                Sample Note Live Preview:
                              </span>
                              <div className="font-bold text-gray-900 dark:text-gray-100">
                                {sampleNote.fields[currentMapping.characterField] || '(Empty Front)'}
                                {currentMapping.readingField && sampleNote.fields[currentMapping.readingField] && (
                                  <span className="font-normal text-gray-500 ml-2">
                                    ({sampleNote.fields[currentMapping.readingField]})
                                  </span>
                                )}
                              </div>
                              <div className="text-gray-600 dark:text-gray-400 truncate">
                                {sampleNote.fields[currentMapping.meaningField] || '(Empty Meaning)'}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Anki Importing Progress Stage */}
              {ankiStage === 'importing' && (
                <div className="py-12 text-center space-y-4">
                  <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    {ankiProgressMsg}
                  </div>
                  <div className="w-full max-w-md bg-gray-200 dark:bg-gray-700 h-2 rounded-full overflow-hidden mx-auto">
                    <div
                      className="bg-indigo-600 h-2 transition-all duration-300"
                      style={{ width: `${ankiProgressPercent}%` }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* TABS 1, 2, 3: CSV / JSON / MARKDOWN VIEW */
            <>
              {!previewItems ? (
                <>
                  {activeTab === 'delimited' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <label className="text-xs font-semibold text-gray-500">Delimiter:</label>
                          <select
                            value={delimiter}
                            onChange={(e) => setDelimiter(e.target.value)}
                            className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs"
                          >
                            <option value=",">Comma (,)</option>
                            <option value="&#9;">Tab (\t)</option>
                            <option value=";">Semicolon (;)</option>
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={() => setInputText(sampleCsv)}
                          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          Insert Curriculum CSV Sample
                        </button>
                      </div>

                      <textarea
                        rows={8}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder={`character,meaning,reading,pitchOrTone,radicals,exampleSentence,notes,tags,book,chapter\n食べる,To eat,たべる,,食,毎日りんごを食べます。,Ichidan,verb,Minna no Nihongo 1,Chapter 1`}
                        className="w-full px-4 py-3 rounded-2xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 font-mono text-xs focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-gray-900 outline-none transition-all resize-none"
                      />
                      <p className="text-[11px] text-gray-500">
                        Supports columns: <code className="text-indigo-600 font-mono">character</code>, <code className="text-indigo-600 font-mono">meaning</code>, <code className="text-indigo-600 font-mono">reading</code>, <code className="text-indigo-600 font-mono">exampleSentence</code>, <code className="text-indigo-600 font-mono">notes</code>, <code className="text-indigo-600 font-mono">tags</code>, <code className="text-indigo-600 font-mono">book</code>, and <code className="text-indigo-600 font-mono">chapter</code>.
                      </p>
                    </div>
                  )}

                  {activeTab === 'json' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          JSON Array or Lesson Dictionary:
                        </label>
                        <button
                          type="button"
                          onClick={() => setInputText(sampleJson)}
                          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          Insert Example
                        </button>
                      </div>
                      <textarea
                        rows={8}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder={`[\n  {\n    "character": "食べる",\n    "reading": "たべる",\n    "meaning": "To eat",\n    "book": "Minna no Nihongo 1",\n    "chapter": "Chapter 1"\n  }\n]`}
                        className="w-full px-4 py-3 rounded-2xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 font-mono text-xs focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-gray-900 outline-none transition-all resize-none"
                      />
                    </div>
                  )}

                  {activeTab === 'markdown' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Markdown Quick-Paste Text:
                        </label>
                        <button
                          type="button"
                          onClick={() => setInputText(sampleMarkdown)}
                          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          Insert Example
                        </button>
                      </div>
                      <textarea
                        rows={8}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder="Character(reading) :: Meaning // Example sentence (notes) #tags"
                        className="w-full px-4 py-3 rounded-2xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 font-mono text-xs focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-gray-900 outline-none transition-all resize-none"
                      />
                      <p className="text-xs text-gray-400">
                        Syntax: <code className="text-indigo-500 font-semibold">Word(reading) :: Meaning // Example Sentence #tags</code>
                      </p>
                    </div>
                  )}

                  {/* Universal File Picker supporting .csv, .tsv, .txt, .apkg, .colpkg, .json */}
                  <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500 border-t border-gray-100 dark:border-gray-800">
                    <span className="font-medium">Or select file from your computer:</span>
                    <label className="cursor-pointer px-4 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 flex items-center gap-2 font-semibold shadow-sm transition-all">
                      <Upload className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      <span>Choose File (.csv, .tsv, .apkg, .json, .txt)</span>
                      <input
                        type="file"
                        accept=".csv,.tsv,.txt,.apkg,.colpkg,.json,.md"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleProcessFile(f);
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                </>
              ) : (
                /* Inspection Preview View */
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/50">
                    <div>
                      <div className="font-semibold text-indigo-950 dark:text-indigo-200">
                        Inspection Ready: {previewItems.length} items parsed
                      </div>
                      <div className="text-xs text-indigo-700 dark:text-indigo-400 mt-0.5">
                        {newCount} brand new cards • {duplicateCount} duplicate terms detected on [character + reading]
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreviewItems(null)}
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                    >
                      Edit Input Text
                    </button>
                  </div>

                  {duplicateCount > 0 && (
                    <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 space-y-2">
                      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-semibold text-xs uppercase tracking-wide">
                        <AlertTriangle className="w-4 h-4" /> Duplicate Resolution Strategy
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <label
                          className={`p-3 rounded-xl border cursor-pointer text-xs flex flex-col justify-between transition-all ${
                            duplicateStrategy === 'merge'
                              ? 'border-indigo-500 bg-white dark:bg-gray-900 shadow-sm'
                              : 'border-transparent bg-amber-100/60 dark:bg-amber-900/30'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 font-bold mb-1">
                            <input
                              type="radio"
                              name="dupStrat"
                              checked={duplicateStrategy === 'merge'}
                              onChange={() => setDuplicateStrategy('merge')}
                              className="text-indigo-600"
                            />
                            <span>Merge (Recommended)</span>
                          </div>
                          <span className="text-[11px] text-gray-500">
                            Links deck into secondaryDeckIds without duplicate reviews.
                          </span>
                        </label>

                        <label
                          className={`p-3 rounded-xl border cursor-pointer text-xs flex flex-col justify-between transition-all ${
                            duplicateStrategy === 'skip'
                              ? 'border-indigo-500 bg-white dark:bg-gray-900 shadow-sm'
                              : 'border-transparent bg-amber-100/60 dark:bg-amber-900/30'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 font-bold mb-1">
                            <input
                              type="radio"
                              name="dupStrat"
                              checked={duplicateStrategy === 'skip'}
                              onChange={() => setDuplicateStrategy('skip')}
                              className="text-indigo-600"
                            />
                            <span>Skip Duplicates</span>
                          </div>
                          <span className="text-[11px] text-gray-500">
                            Ignores existing terms; imports only completely new items.
                          </span>
                        </label>

                        <label
                          className={`p-3 rounded-xl border cursor-pointer text-xs flex flex-col justify-between transition-all ${
                            duplicateStrategy === 'separate'
                              ? 'border-indigo-500 bg-white dark:bg-gray-900 shadow-sm'
                              : 'border-transparent bg-amber-100/60 dark:bg-amber-900/30'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 font-bold mb-1">
                            <input
                              type="radio"
                              name="dupStrat"
                              checked={duplicateStrategy === 'separate'}
                              onChange={() => setDuplicateStrategy('separate')}
                              className="text-indigo-600"
                            />
                            <span>Keep Separate</span>
                          </div>
                          <span className="text-[11px] text-gray-500">
                            Creates an independent new note and card anyway.
                          </span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Preview List with Book & Chapter hierarchy tags */}
                  <div className="max-h-60 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800 rounded-2xl border border-gray-200 dark:border-gray-800">
                    {previewItems.slice(0, 60).map((preview, idx) => (
                      <div key={idx} className="p-3 flex items-center justify-between text-xs">
                        <div className="space-y-1">
                          <div className="font-semibold text-gray-900 dark:text-gray-100 flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold">{preview.item.character}</span>
                            {preview.item.reading && (
                              <span className="text-gray-500 font-normal">({preview.item.reading})</span>
                            )}

                            {preview.item.book && (
                              <span className="px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 text-[10px] flex items-center gap-1 font-medium">
                                <FolderTree className="w-3 h-3 text-indigo-500" />
                                {preview.item.book}
                                {preview.item.chapter ? ` › ${preview.item.chapter}` : ''}
                              </span>
                            )}

                            {preview.status === 'duplicate' ? (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 text-[10px] font-semibold">
                                Duplicate (In {preview.existingDeckNames?.join(', ') || 'another deck'})
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold">
                                New
                              </span>
                            )}
                          </div>
                          <div className="text-gray-600 dark:text-gray-400 truncate max-w-lg">
                            {preview.item.meaning}
                          </div>
                          {preview.item.exampleSentence && (
                            <div className="text-[11px] text-gray-400 italic truncate max-w-lg">
                              Ex: {preview.item.exampleSentence}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {previewItems.length > 60 && (
                      <div className="p-2.5 text-center text-xs text-gray-400 font-medium">
                        +{previewItems.length - 60} more items parsed
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          <button
            type="button"
            onClick={handleResetAndClose}
            className="px-4 py-2 rounded-xl text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 font-medium transition-colors"
          >
            Cancel
          </button>

          {activeTab === 'anki' ? (
            <>
              {ankiStage === 'mapping' && (
                <button
                  type="button"
                  onClick={handleCommitAnki}
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-md shadow-indigo-500/20 transition-all"
                >
                  Commit Ingestion to FSRS
                </button>
              )}
            </>
          ) : (
            <>
              {!previewItems ? (
                <button
                  type="button"
                  disabled={analyzing || !inputText.trim()}
                  onClick={handleManualAnalyze}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-md shadow-indigo-500/20 flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  {analyzing ? 'Analyzing...' : 'Inspect & Preview'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={textImporting}
                  onClick={handleExecuteTextImport}
                  className="px-6 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-md shadow-indigo-500/20 flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  {textImporting ? 'Importing...' : `Import ${previewItems.length} Cards`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
