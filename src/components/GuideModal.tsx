/**
 * GuideModal.tsx - Comprehensive In-App Knowledge Base & Schema Validator (PRD §4.3 & Phase 4)
 * Provides 4 interactive tabs:
 * 1. Import Schemas, Dry-Run Validator & Sample Template Downloads
 * 2. FSRS-6 DSR Architecture & Study Engine Explained
 * 3. Controls, Stylus Palm Rejection & Keyboard Shortcuts
 * 4. Offline PWA (7-Day WebKit Storage Exemption) & Multi-Device Sync Protocols
 */

import React, { useState, useRef } from 'react';
import {
  X,
  BookOpen,
  Brain,
  Keyboard,
  Wifi,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  FileText,
  FileCode,
  Sparkles,
  Smartphone,
  QrCode,
  FileArchive,
  HardDrive,
  Clock,
  Layers,
  ChevronRight,
  Info,
} from 'lucide-react';

interface GuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'schemas' | 'fsrs' | 'controls' | 'pwa';
}

type GuideTab = 'schemas' | 'fsrs' | 'controls' | 'pwa';

interface ValidationResult {
  fileName: string;
  fileType: 'csv' | 'tsv' | 'json' | 'markdown' | 'unknown';
  totalRows: number;
  validRows: number;
  errors: string[];
  warnings: string[];
  headers: string[];
  sampleItems: Array<{ character: string; meaning: string; reading?: string }>;
}

export const GuideModal: React.FC<GuideModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'schemas',
}) => {
  const [activeTab, setActiveTab] = useState<GuideTab>(initialTab);

  // Schema Validator State
  const [dragActive, setDragActive] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // --- Sample Template Generators ---
  const downloadSampleFile = (type: 'csv' | 'tsv' | 'json' | 'md') => {
    let content = '';
    let filename = '';
    let mimeType = 'text/plain;charset=utf-8';

    switch (type) {
      case 'csv':
        filename = 'pocketsrs_template.csv';
        mimeType = 'text/csv;charset=utf-8';
        content = [
          'character,meaning,reading,pitchOrTone,radicals,exampleSentence,notes,tags,book,chapter',
          '食べる,To eat,たべる,[2],食,毎日りんごを食べます (I eat an apple every day).,Ichidan verb; transitive,jlpt-n5;verbs,Minna no Nihongo,Chapter 1',
          '学校,School,がっこう,[0],木;父,明日学校に行きます (I go to school tomorrow).,Noun,jlpt-n5;places,Minna no Nihongo,Chapter 1',
          '勉強(べんきょう),To study,べんきょう,[0],力,日本語を勉強します (I study Japanese).,Suru verb with inline reading,jlpt-n5,Minna no Nihongo,Chapter 2',
        ].join('\n');
        break;

      case 'tsv':
        filename = 'pocketsrs_template.tsv';
        mimeType = 'text/tab-separated-values;charset=utf-8';
        content = [
          'character\tmeaning\treading\tpitchOrTone\tradicals\texampleSentence\tnotes\ttags\tbook\tchapter',
          '飲む\tTo drink\tのむ\t[1]\t食\tお茶を飲みます。\tGodan verb\tjlpt-n5\tGenki I\tLesson 3',
          '本\tBook\tほん\t[1]\t木\t本を読みます。\tNoun\tjlpt-n5\tGenki I\tLesson 3',
        ].join('\n');
        break;

      case 'json':
        filename = 'pocketsrs_deck_package.json';
        mimeType = 'application/json;charset=utf-8';
        content = JSON.stringify(
          {
            version: 1,
            deck: {
              name: 'Japanese Core 1000',
              book: 'Core Series',
              chapter: 'Unit 1: Essentials',
              language: 'ja-JP',
              requestRetention: 0.90,
              newCardsPerDay: 15,
            },
            notes: [
              {
                character: '先生',
                meaning: 'Teacher / Instructor',
                reading: 'せんせい',
                pitchOrTone: '[3]',
                radicals: ['牛', '儿'],
                exampleSentence: '田中先生はとても優しいです (Teacher Tanaka is very kind).',
                notes: 'Honorific title used for educators and doctors.',
                tags: ['people', 'n5'],
              },
              {
                character: '車',
                meaning: 'Car / Automobile',
                reading: 'くるま',
                pitchOrTone: '[0]',
                radicals: ['車'],
                exampleSentence: '新しい車を買いました (I bought a new car).',
                notes: 'Kanji pictograph depicting a cart viewed from above.',
                tags: ['transport', 'n5'],
              },
            ],
          },
          null,
          2
        );
        break;

      case 'md':
        filename = 'pocketsrs_quickpaste.md';
        mimeType = 'text/markdown;charset=utf-8';
        content = [
          '# PocketSRS Quick-Paste & Cloze Template',
          '',
          '## 1. Quick-Paste Syntax (Character(Reading) :: Meaning // Sentence || Notes #tags)',
          '犬(いぬ) :: Dog // 公園で犬が走っています (A dog is running in the park) || Common domestic animal #animals #n5',
          '猫(ねこ) :: Cat // 私の猫は寝ています (My cat is sleeping) #animals #n5',
          '美しい(うつくしい) :: Beautiful // 富士山は美しいです (Mt. Fuji is beautiful) || i-adjective #adjectives',
          '',
          '## 2. Cloze Deletion Syntax ({{c1::answer::hint}})',
          'Tokyo is the {{c1::capital::status}} of {{c2::Japan::country}}, established as the seat in {{c3::1868::year}}.',
          'The human body contains {{c1::206::number}} bones in the adult skeleton.',
        ].join('\n');
        break;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // --- Dry-Run Schema Validator Engine ---
  const validateUploadedFile = async (file: File) => {
    setIsValidating(true);
    const name = file.name.toLowerCase();
    const text = await file.text();

    const errors: string[] = [];
    const warnings: string[] = [];
    const sampleItems: Array<{ character: string; meaning: string; reading?: string }> = [];
    let detectedHeaders: string[] = [];
    let totalRows = 0;
    let validRows = 0;
    let detectedType: 'csv' | 'tsv' | 'json' | 'markdown' | 'unknown' = 'unknown';

    try {
      if (name.endsWith('.json')) {
        detectedType = 'json';
        const parsed = JSON.parse(text);
        const notes = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.notes)
          ? parsed.notes
          : null;

        if (!notes) {
          errors.push('JSON root must be an array of notes or an object with a "notes" array property.');
        } else {
          totalRows = notes.length;
          detectedHeaders = Object.keys(notes[0] || {});

          notes.forEach((item: any, idx: number) => {
            const rowNum = idx + 1;
            const char = item.character || item.front;
            const mean = item.meaning || item.back;

            if (!char || typeof char !== 'string' || char.trim() === '') {
              errors.push(`Item #${rowNum}: Missing required "character" (or "front") string.`);
            } else if (!mean || typeof mean !== 'string' || mean.trim() === '') {
              errors.push(`Item #${rowNum} ("${char}"): Missing required "meaning" (or "back") string.`);
            } else {
              validRows++;
              if (sampleItems.length < 5) {
                sampleItems.push({
                  character: char.trim(),
                  meaning: mean.trim(),
                  reading: item.reading,
                });
              }
            }
          });
        }
      } else if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
        const isTsv = name.endsWith('.tsv') || text.includes('\t');
        detectedType = isTsv ? 'tsv' : 'csv';
        const delimiter = isTsv ? '\t' : ',';

        const lines = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        if (lines.length === 0) {
          errors.push('File is completely empty.');
        } else {
          // Detect header
          const rawHeader = lines[0].split(delimiter).map((h) => h.replace(/^["']|["']$/g, '').trim());
          detectedHeaders = rawHeader;

          const charIdx = rawHeader.findIndex(
            (h) => ['character', 'front', 'kanji', 'hanzi', 'target', 'word'].includes(h.toLowerCase())
          );
          const meanIdx = rawHeader.findIndex(
            (h) => ['meaning', 'back', 'translation', 'english', 'definition'].includes(h.toLowerCase())
          );
          const readIdx = rawHeader.findIndex(
            (h) => ['reading', 'kana', 'pinyin', 'furigana', 'pronunciation'].includes(h.toLowerCase())
          );

          if (charIdx === -1) {
            errors.push('Missing required column header: "character" (or "front", "word", "kanji").');
          }
          if (meanIdx === -1) {
            errors.push('Missing required column header: "meaning" (or "back", "translation").');
          }

          const dataLines = lines.slice(1);
          totalRows = dataLines.length;

          dataLines.forEach((line, idx) => {
            const rowNum = idx + 2;
            const cols = line.split(delimiter).map((c) => c.replace(/^["']|["']$/g, '').trim());
            const char = charIdx >= 0 ? cols[charIdx] : '';
            const mean = meanIdx >= 0 ? cols[meanIdx] : '';
            const read = readIdx >= 0 ? cols[readIdx] : undefined;

            if (!char) {
              errors.push(`Row ${rowNum}: Empty character field.`);
            } else if (!mean) {
              errors.push(`Row ${rowNum} ("${char}"): Empty meaning field.`);
            } else {
              validRows++;
              if (sampleItems.length < 5) {
                sampleItems.push({
                  character: char,
                  meaning: mean,
                  reading: read,
                });
              }
            }
          });
        }
      } else if (name.endsWith('.md')) {
        detectedType = 'markdown';
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0 && !l.startsWith('#'));
        totalRows = lines.length;

        lines.forEach((line, idx) => {
          const rowNum = idx + 1;
          if (line.includes('::')) {
            const [frontPart, backPart] = line.split('::').map((s) => s.trim());
            if (frontPart && backPart) {
              validRows++;
              if (sampleItems.length < 5) {
                sampleItems.push({
                  character: frontPart,
                  meaning: backPart.split('//')[0].split('#')[0].trim(),
                });
              }
            } else {
              errors.push(`Line ${rowNum}: Missing content on left or right of "::"`);
            }
          } else if (line.includes('{{c') && line.includes('}}')) {
            validRows++;
            if (sampleItems.length < 5) {
              sampleItems.push({
                character: line.substring(0, 40) + '...',
                meaning: '[Cloze Deletion Card]',
              });
            }
          } else {
            warnings.push(`Line ${rowNum}: Ignored (does not match "::" syntax or Cloze "{{c1::...}}")`);
          }
        });
      } else {
        errors.push('Unsupported file extension. Please select a .csv, .tsv, .json, or .md file.');
      }
    } catch (err: any) {
      errors.push(`Parser Exception: ${err.message || String(err)}`);
    }

    setValidationResult({
      fileName: file.name,
      fileType: detectedType,
      totalRows,
      validRows,
      errors,
      warnings,
      headers: detectedHeaders,
      sampleItems,
    });
    setIsValidating(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateUploadedFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 animate-fadeIn">
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header Bar */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                PocketSRS Knowledge Base
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                  v2.2
                </span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Import schemas, dry-run validator, FSRS-6 math, shortcuts & PWA offline guide
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 gap-2 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveTab('schemas')}
            className={`py-3 px-3 text-xs md:text-sm font-semibold border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
              activeTab === 'schemas'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'
            }`}
          >
            <FileCode className="w-4 h-4" />
            <span>Import Schemas & Validator</span>
          </button>

          <button
            onClick={() => setActiveTab('fsrs')}
            className={`py-3 px-3 text-xs md:text-sm font-semibold border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
              activeTab === 'fsrs'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'
            }`}
          >
            <Brain className="w-4 h-4" />
            <span>FSRS-6 & Study Engine</span>
          </button>

          <button
            onClick={() => setActiveTab('controls')}
            className={`py-3 px-3 text-xs md:text-sm font-semibold border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
              activeTab === 'controls'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'
            }`}
          >
            <Keyboard className="w-4 h-4" />
            <span>Controls & Shortcuts</span>
          </button>

          <button
            onClick={() => setActiveTab('pwa')}
            className={`py-3 px-3 text-xs md:text-sm font-semibold border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
              activeTab === 'pwa'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'
            }`}
          >
            <Wifi className="w-4 h-4" />
            <span>Offline PWA & Sync</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: SCHEMAS & VALIDATOR */}
          {activeTab === 'schemas' && (
            <div className="space-y-6">
              {/* Download Sample Templates Bar */}
              <div className="bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/50 rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    Download Ready-to-Use Sample Templates
                  </h3>
                  <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-0.5">
                    Generate valid, pre-formatted files containing sample vocabulary and rich metadata.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => downloadSampleFile('csv')}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 shadow-sm border border-gray-200 dark:border-gray-700 flex items-center gap-1.5 transition-all"
                  >
                    <Download className="w-3.5 h-3.5 text-indigo-600" />
                    CSV Template
                  </button>
                  <button
                    onClick={() => downloadSampleFile('tsv')}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 shadow-sm border border-gray-200 dark:border-gray-700 flex items-center gap-1.5 transition-all"
                  >
                    <Download className="w-3.5 h-3.5 text-indigo-600" />
                    TSV Template
                  </button>
                  <button
                    onClick={() => downloadSampleFile('json')}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 shadow-sm border border-gray-200 dark:border-gray-700 flex items-center gap-1.5 transition-all"
                  >
                    <Download className="w-3.5 h-3.5 text-indigo-600" />
                    JSON Package
                  </button>
                  <button
                    onClick={() => downloadSampleFile('md')}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 shadow-sm border border-gray-200 dark:border-gray-700 flex items-center gap-1.5 transition-all"
                  >
                    <Download className="w-3.5 h-3.5 text-indigo-600" />
                    Markdown Quick-Paste
                  </button>
                </div>
              </div>

              {/* Dry-Run Schema Validator Dropzone */}
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      Dry-Run Schema Validator
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Drop any file here to verify headers, required columns, and syntax before importing into your database.
                    </p>
                  </div>
                </div>

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                    dragActive
                      ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-gray-50/50 dark:bg-gray-800/30'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.tsv,.json,.md,.txt"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        validateUploadedFile(e.target.files[0]);
                      }
                    }}
                    className="hidden"
                  />
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {isValidating ? 'Analyzing Schema...' : 'Drop CSV, TSV, JSON, or MD to Validate'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Or click to browse your local device
                  </p>
                </div>

                {/* Validation Results Card */}
                {validationResult && (
                  <div className="mt-4 p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 space-y-3 animate-fadeIn">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-900 dark:text-gray-100">
                          {validationResult.fileName}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                          {validationResult.fileType}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {validationResult.errors.length === 0 ? (
                          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Ready to Import ({validationResult.validRows} / {validationResult.totalRows} valid)
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400 flex items-center gap-1">
                            <AlertCircle className="w-3.5 h-3.5" />
                            {validationResult.errors.length} Issue(s) Detected
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Detected Headers */}
                    {validationResult.headers.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap text-xs">
                        <span className="text-gray-400 font-semibold">Detected Columns:</span>
                        {validationResult.headers.map((h, i) => (
                          <span
                            key={i}
                            className={`px-2 py-0.5 rounded font-mono text-[11px] ${
                              ['character', 'front', 'meaning', 'back'].includes(h.toLowerCase())
                                ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold'
                                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {h}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Error List */}
                    {validationResult.errors.length > 0 && (
                      <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 space-y-1">
                        <p className="text-xs font-bold text-rose-700 dark:text-rose-400">
                          Validation Errors:
                        </p>
                        <ul className="text-xs text-rose-600 dark:text-rose-300 list-disc list-inside space-y-0.5">
                          {validationResult.errors.slice(0, 5).map((err, idx) => (
                            <li key={idx}>{err}</li>
                          ))}
                          {validationResult.errors.length > 5 && (
                            <li className="font-semibold">
                              ...and {validationResult.errors.length - 5} more issues.
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    {/* Warnings List */}
                    {validationResult.warnings.length > 0 && (
                      <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 space-y-1">
                        <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
                          Notices & Skipped Lines:
                        </p>
                        <ul className="text-xs text-amber-600 dark:text-amber-300 list-disc list-inside space-y-0.5">
                          {validationResult.warnings.slice(0, 3).map((w, idx) => (
                            <li key={idx}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Sample Preview Items */}
                    {validationResult.sampleItems.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                          Sample Parsed Items:
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {validationResult.sampleItems.map((item, idx) => (
                            <div
                              key={idx}
                              className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 flex items-center justify-between text-xs"
                            >
                              <div>
                                <span className="font-bold text-gray-900 dark:text-gray-100">
                                  {item.character}
                                </span>
                                {item.reading && (
                                  <span className="ml-1.5 text-indigo-600 dark:text-indigo-400 text-[11px]">
                                    ({item.reading})
                                  </span>
                                )}
                              </div>
                              <span className="text-gray-500 dark:text-gray-400 truncate max-w-[150px]">
                                {item.meaning}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Supported Schema Specifications */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  Format Reference Specifications
                </h3>

                {/* CSV / TSV Schema */}
                <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-gray-900 dark:text-gray-100">
                      1. CSV / TSV Schema
                    </span>
                    <span className="text-xs font-mono text-gray-400">UTF-8 Encoded</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                    Comma-separated or Tab-separated values with a header row. Quotes are respected. PocketSRS will automatically map the hierarchy using optional <code className="text-indigo-600">book</code> and <code className="text-indigo-600">chapter</code> columns.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-400 font-mono">
                          <th className="py-1 px-2">Column Header</th>
                          <th className="py-1 px-2">Requirement</th>
                          <th className="py-1 px-2">Description & Example</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-800 text-gray-600 dark:text-gray-300">
                        <tr>
                          <td className="py-1.5 px-2 font-mono font-semibold text-indigo-600 dark:text-indigo-400">character</td>
                          <td className="py-1.5 px-2 text-rose-500 font-bold">Required</td>
                          <td className="py-1.5 px-2">Target script or front word (e.g., <code className="text-gray-800 dark:text-gray-200">食べる</code> or <code className="text-gray-800 dark:text-gray-200">食べる(たべる)</code>)</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 px-2 font-mono font-semibold text-indigo-600 dark:text-indigo-400">meaning</td>
                          <td className="py-1.5 px-2 text-rose-500 font-bold">Required</td>
                          <td className="py-1.5 px-2">Definition, translation, or prompt (e.g., <code className="text-gray-800 dark:text-gray-200">To eat</code>)</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 px-2 font-mono">reading</td>
                          <td className="py-1.5 px-2 text-gray-400">Optional</td>
                          <td className="py-1.5 px-2">Phonetic pronunciation (e.g., <code className="text-gray-800 dark:text-gray-200">たべる</code> or <code className="text-gray-800 dark:text-gray-200">chī</code>)</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 px-2 font-mono">pitchOrTone</td>
                          <td className="py-1.5 px-2 text-gray-400">Optional</td>
                          <td className="py-1.5 px-2">Pitch pattern or tone contours (e.g., <code className="text-gray-800 dark:text-gray-200">[2]</code> or <code className="text-gray-800 dark:text-gray-200">1st tone</code>)</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 px-2 font-mono">radicals</td>
                          <td className="py-1.5 px-2 text-gray-400">Optional</td>
                          <td className="py-1.5 px-2">Semicolon-separated radical glyphs (e.g., <code className="text-gray-800 dark:text-gray-200">食;人</code>)</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 px-2 font-mono">exampleSentence</td>
                          <td className="py-1.5 px-2 text-gray-400">Optional</td>
                          <td className="py-1.5 px-2">Contextual sentence with translation</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 px-2 font-mono">tags</td>
                          <td className="py-1.5 px-2 text-gray-400">Optional</td>
                          <td className="py-1.5 px-2">Semicolon or space-separated tags (e.g., <code className="text-gray-800 dark:text-gray-200">n5;verbs</code>)</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 px-2 font-mono">book / chapter</td>
                          <td className="py-1.5 px-2 text-gray-400">Optional</td>
                          <td className="py-1.5 px-2">Folder grouping into Book & Chapter hierarchy</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Markdown Quick-Paste & Cloze */}
                <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 space-y-2">
                  <span className="font-bold text-sm text-gray-900 dark:text-gray-100">
                    2. Markdown Quick-Paste & Cloze Syntax
                  </span>
                  <div className="bg-gray-900 text-gray-100 p-3 rounded-xl font-mono text-xs overflow-x-auto space-y-1">
                    <p className="text-emerald-400 font-semibold"># Standard Flashcard Syntax:</p>
                    <p>食べる(たべる) :: To eat // 毎日りんごを食べます || Ichidan verb #jlpt-n5</p>
                    <p className="text-indigo-400 font-semibold mt-2"># Cloze Deletion Syntax:</p>
                    <p>Mount Fuji is the tallest peak in {`{{c1::Japan::country}}`} at {`{{c2::3,776 meters::height}}`}.</p>
                  </div>
                </div>

                {/* Anki APKG */}
                <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 space-y-2">
                  <span className="font-bold text-sm text-gray-900 dark:text-gray-100">
                    3. Anki Package (.apkg & .anki21b)
                  </span>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    Direct decompression using Wasm-accelerated <code className="text-indigo-600">fzstd</code> and <code className="text-indigo-600">sql.js</code>. The interactive field mapper automatically lets you bind Anki note model fields to Character, Meaning, Reading, and OPFS Audio without losing your collection structure.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: FSRS-6 & STUDY MODES */}
          {activeTab === 'fsrs' && (
            <div className="space-y-6">
              <div className="p-5 rounded-2xl bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/40 dark:to-purple-950/40 border border-indigo-200 dark:border-indigo-900/50 space-y-2">
                <h3 className="text-base font-bold text-indigo-950 dark:text-indigo-200 flex items-center gap-2">
                  <Brain className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  Free Spaced Repetition Scheduler (FSRS-6)
                </h3>
                <p className="text-xs text-indigo-800 dark:text-indigo-300 leading-relaxed">
                  PocketSRS v2.2 is powered by FSRS-6, a modern memory scheduling algorithm that outperforms classic SM-2 by over 30% in retention efficiency. FSRS tracks your personal memory parameters across three physiological dimensions (DSR).
                </p>
              </div>

              {/* DSR Pillars */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-2xl bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 space-y-2">
                  <div className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold text-sm">
                    D
                  </div>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Difficulty (1 - 10)</h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                    Represents how intrinsically hard the item is to retain. Higher difficulty items suffer faster retrievability decay and need more reinforcement.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 space-y-2">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-sm">
                    S
                  </div>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Stability (Days)</h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                    The time duration required for the probability of recall to drop to your target retention (e.g., 90%). Stability increases after every successful recall.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 space-y-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-sm">
                    R
                  </div>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Retrievability (0 - 100%)</h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                    The calculated probability of successfully recalling the item at this exact second, modeled by the power-law forgetting curve.
                  </p>
                </div>
              </div>

              {/* The 4 Rating Buttons */}
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 space-y-4 shadow-sm">
                <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  Rating Button Mechanics
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/50 dark:bg-rose-950/20 space-y-1">
                    <span className="font-bold text-rose-700 dark:text-rose-400">1: Again (Lapse)</span>
                    <p className="text-gray-600 dark:text-gray-300">
                      Total blackout or incorrect recall. Resets stability, increments lapses, and enters learning steps (1m, 10m).
                    </p>
                  </div>
                  <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 space-y-1">
                    <span className="font-bold text-amber-700 dark:text-amber-400">2: Hard</span>
                    <p className="text-gray-600 dark:text-gray-300">
                      Recalled after significant hesitation or struggle. Stability grows modestly, increasing difficulty metric.
                    </p>
                  </div>
                  <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-1">
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">3: Good (Standard)</span>
                    <p className="text-gray-600 dark:text-gray-300">
                      Correct recall with normal effort. Schedules card to hit your exact desired retention (e.g. 90%).
                    </p>
                  </div>
                  <div className="p-3 rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 space-y-1">
                    <span className="font-bold text-blue-700 dark:text-blue-400">4: Easy</span>
                    <p className="text-gray-600 dark:text-gray-300">
                      Immediate, effortless recall. Decreases difficulty and multiplies next stability interval.
                    </p>
                  </div>
                </div>
              </div>

              {/* Special Engine Features */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 space-y-1.5">
                  <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold text-xs">
                    <Clock className="w-4 h-4" />
                    <span>04:00 AM Logical Rollover</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    Late-night study sessions between midnight and 3:59 AM count towards the current day’s quota. Your queues will never reset mid-session at midnight.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 space-y-1.5">
                  <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold text-xs">
                    <Layers className="w-4 h-4" />
                    <span>Automated Sibling Burying</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    When you review a Recognition card (Kanji → Meaning), its twin Production card is automatically buried until tomorrow’s rollover to prevent artificial short-term priming.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: CONTROLS & SHORTCUTS */}
          {activeTab === 'controls' && (
            <div className="space-y-6">
              {/* Swipe Gestures */}
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm space-y-3">
                <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  Mobile & Tablet Touch Gestures
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                    <p className="font-bold text-gray-800 dark:text-gray-200">Swipe Left</p>
                    <p className="text-rose-500 font-semibold mt-1">Rate Again (1)</p>
                  </div>
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                    <p className="font-bold text-gray-800 dark:text-gray-200">Swipe Right</p>
                    <p className="text-emerald-500 font-semibold mt-1">Rate Good (3)</p>
                  </div>
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                    <p className="font-bold text-gray-800 dark:text-gray-200">Swipe Up</p>
                    <p className="text-blue-500 font-semibold mt-1">Rate Easy (4)</p>
                  </div>
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                    <p className="font-bold text-gray-800 dark:text-gray-200">Swipe Down</p>
                    <p className="text-indigo-500 font-semibold mt-1">Reveal Answer</p>
                  </div>
                </div>
              </div>

              {/* Stylus Palm Rejection */}
              <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 space-y-2">
                <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  Stylus Scratchpad with Hardware Palm Rejection
                </h4>
                <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                  When using an Apple Pencil, Samsung S-Pen, or standard stylus, PocketSRS leverages pointer event inspection (<code className="text-indigo-600">pointerType === 'pen'</code>) to ignore palm contact. Toggle the ghost guide to inspect kanji/hanzi proportions while practicing stroke memory.
                </p>
              </div>

              {/* Keyboard Shortcuts Table */}
              <div className="space-y-2">
                <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <Keyboard className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  Keyboard Shortcuts Master Table
                </h4>
                <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                      <tr>
                        <th className="py-2.5 px-4 font-semibold">Key</th>
                        <th className="py-2.5 px-4 font-semibold">Action</th>
                        <th className="py-2.5 px-4 font-semibold">Context</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900">
                      <tr>
                        <td className="py-2 px-4"><kbd className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 font-mono font-bold">Space</kbd></td>
                        <td className="py-2 px-4 font-semibold">Flip Card / Show Answer</td>
                        <td className="py-2 px-4 text-gray-400">Study Session</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-4"><kbd className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 font-mono font-bold">1</kbd> / <kbd className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 font-mono font-bold">2</kbd> / <kbd className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 font-mono font-bold">3</kbd> / <kbd className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 font-mono font-bold">4</kbd></td>
                        <td className="py-2 px-4 font-semibold">Rate: Again / Hard / Good / Easy</td>
                        <td className="py-2 px-4 text-gray-400">Card Back (Revealed)</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-4"><kbd className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 font-mono font-bold">E</kbd></td>
                        <td className="py-2 px-4 font-semibold">Open Quick Edit Modal</td>
                        <td className="py-2 px-4 text-gray-400">Any active card</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-4"><kbd className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 font-mono font-bold">F</kbd></td>
                        <td className="py-2 px-4 font-semibold">Cycle Flag (None → Red → Orange → Green → Blue)</td>
                        <td className="py-2 px-4 text-gray-400">Study Session</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-4"><kbd className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 font-mono font-bold">B</kbd></td>
                        <td className="py-2 px-4 font-semibold">Bury Card until next 04:00 AM Rollover</td>
                        <td className="py-2 px-4 text-gray-400">Study Session</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-4"><kbd className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 font-mono font-bold">@</kbd></td>
                        <td className="py-2 px-4 font-semibold">Suspend / Unsuspend Card</td>
                        <td className="py-2 px-4 text-gray-400">Study Session</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-4"><kbd className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 font-mono font-bold">Z</kbd></td>
                        <td className="py-2 px-4 font-semibold">Instant Undo (Revocable Revlog rollback)</td>
                        <td className="py-2 px-4 text-gray-400">Study Session</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-4"><kbd className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 font-mono font-bold">R</kbd></td>
                        <td className="py-2 px-4 font-semibold">Replay Audio TTS Speech</td>
                        <td className="py-2 px-4 text-gray-400">Study Session</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-4"><kbd className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 font-mono font-bold">?</kbd></td>
                        <td className="py-2 px-4 font-semibold">Open In-App Guide & Documentation</td>
                        <td className="py-2 px-4 text-gray-400">Global (Dashboard & Study)</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: OFFLINE PWA & SYNC */}
          {activeTab === 'pwa' && (
            <div className="space-y-6">
              {/* WebKit 7-Day Protection Alert */}
              <div className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 space-y-2">
                <h4 className="text-sm font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2">
                  <Info className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  Important: iOS Safari 7-Day Storage Eviction & PWA Installation
                </h4>
                <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  Apple WebKit enforces a strict 7-day storage eviction policy on regular browser tabs: if you do not open Safari for 7 consecutive days, IndexedDB data can be deleted to save flash memory.
                  <br />
                  <strong className="text-amber-950 dark:text-amber-100 font-semibold">
                    Solution: Add PocketSRS to your Home Screen!
                  </strong>{' '}
                  When installed as a standalone PWA, iOS exempts the app from automatic eviction, granting persistent OPFS media storage and offline caching.
                </p>
                <div className="pt-2 flex flex-wrap gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  <span className="px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/60">
                    1. Tap Share (□↑) in Safari
                  </span>
                  <ChevronRight className="w-4 h-4 self-center text-amber-500" />
                  <span className="px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/60">
                    2. Select "Add to Home Screen"
                  </span>
                  <ChevronRight className="w-4 h-4 self-center text-amber-500" />
                  <span className="px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/60">
                    3. Launch as Standalone App
                  </span>
                </div>
              </div>

              {/* Multi-Device Sync Architecture */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 space-y-2">
                  <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                    <QrCode className="w-5 h-5" />
                  </div>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    2-Step QR WebRTC P2P
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                    Zero-cloud direct sync. Device A shows an Offer QR code; Device B scans and displays an Answer QR. Once scanned, cards, notes, logs, and OPFS media stream directly peer-to-peer.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 space-y-2">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                    <HardDrive className="w-5 h-5" />
                  </div>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    Google Drive AppData
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                    Syncs encrypted payloads into Google Drive’s sandboxed <code className="text-indigo-600">drive.appdata</code> folder. Completely invisible in your regular Google Drive, preventing file tampering.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 space-y-2">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <FileArchive className="w-5 h-5" />
                  </div>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    .pocketsrs Snapshots
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                    Single-file full database + OPFS audio archive format. Ideal for cold-storage backups, moving between browsers, or manual offline archiving.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Bar */}
        <div className="px-6 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            Press <kbd className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-mono font-bold">Esc</kbd> or click outside to dismiss
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-500/20 transition-all"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};
