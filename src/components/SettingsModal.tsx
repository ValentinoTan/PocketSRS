/**
 * Expanded Power-User Settings Modal (PRD §3, §5.4, §6.2 & Phase 4)
 * Provides comprehensive configuration for scheduling, typography, reading modes,
 * audio automation, hardware ergonomics, and leech mitigation.
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Save,
  Sliders,
  Moon,
  Sun,
  Monitor,
  RotateCcw,
  Type,
  Volume2,
  Smartphone,
  AlertTriangle,
  PenTool,
} from 'lucide-react';
import { default_w } from 'ts-fsrs';
import { db, type UserSettingsRecord, DEFAULT_SETTINGS } from '../storage/db';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onThemeChange: (theme: 'light' | 'dark' | 'oled') => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onThemeChange }) => {
  // Existing Settings
  const [algorithm, setAlgorithm] = useState<'fsrs6' | 'sm2'>('fsrs6');
  const [requestRetention, setRequestRetention] = useState(0.90);
  const [dayRolloverHour, setDayRolloverHour] = useState(4);
  const [learningStepsStr, setLearningStepsStr] = useState('1, 10');
  const [relearningStepsStr, setRelearningStepsStr] = useState('10');
  const [theme, setTheme] = useState<'light' | 'dark' | 'oled'>('light');

  // Phase 4 Expanded Power-User Settings
  const [cjkFontStyle, setCjkFontStyle] = useState<'sans' | 'serif' | 'textbook'>('sans');
  const [cardFontSize, setCardFontSize] = useState<'sm' | 'md' | 'lg' | 'xl'>('md');
  const [readingDisplayMode, setReadingDisplayMode] = useState<'tap' | 'always' | 'back_only'>('tap');
  const [autoPlayAudio, setAutoPlayAudio] = useState<'off' | 'front' | 'back' | 'both'>('back');
  const [ttsSpeed, setTtsSpeed] = useState(0.95);
  const [handedness, setHandedness] = useState<'right' | 'left'>('right');
  const [enableHaptics, setEnableHaptics] = useState(true);
  const [autoScratchpad, setAutoScratchpad] = useState<'off' | 'production_only' | 'always'>('production_only');
  const [leechThreshold, setLeechThreshold] = useState(4);
  const [leechAction, setLeechAction] = useState<'flag' | 'suspend'>('flag');
  const [backupReminderDays, setBackupReminderDays] = useState(7);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    db.settings.get('global').then((settings) => {
      if (!settings) return;
      setAlgorithm(settings.algorithm || 'fsrs6');
      setRequestRetention(settings.requestRetention ?? 0.90);
      setDayRolloverHour(settings.dayRolloverHour ?? 4);
      setLearningStepsStr(settings.learningSteps?.join(', ') || '1, 10');
      setRelearningStepsStr(settings.relearningSteps?.join(', ') || '10');
      setTheme(settings.theme || 'light');

      setCjkFontStyle(settings.cjkFontStyle || 'sans');
      setCardFontSize(settings.cardFontSize || 'md');
      setReadingDisplayMode(settings.readingDisplayMode || 'tap');
      setAutoPlayAudio(settings.autoPlayAudio || 'back');
      setTtsSpeed(settings.ttsSpeed ?? 0.95);
      setHandedness(settings.handedness || 'right');
      setEnableHaptics(settings.enableHaptics ?? true);
      setAutoScratchpad(settings.autoScratchpad || 'production_only');
      setLeechThreshold(settings.leechThreshold ?? 4);
      setLeechAction(settings.leechAction || 'flag');
      setBackupReminderDays(settings.backupReminderDays ?? 7);
    });
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoading(true);

    try {
      const learningSteps = learningStepsStr
        .split(/[,;\s]+/)
        .map((s) => parseFloat(s.trim()))
        .filter((n) => !isNaN(n) && n > 0);

      const relearningSteps = relearningStepsStr
        .split(/[,;\s]+/)
        .map((s) => parseFloat(s.trim()))
        .filter((n) => !isNaN(n) && n > 0);

      const existing = await db.settings.get('global');

      const updatedSettings: UserSettingsRecord = {
        id: 'global',
        algorithm,
        fsrsWeights: existing?.fsrsWeights?.length === 21 ? existing.fsrsWeights : Array.from(default_w),
        requestRetention,
        dayRolloverHour,
        learningSteps: learningSteps.length > 0 ? learningSteps : [1, 10],
        relearningSteps: relearningSteps.length > 0 ? relearningSteps : [10],
        theme,

        cjkFontStyle,
        cardFontSize,
        readingDisplayMode,
        autoPlayAudio,
        ttsSpeed,
        handedness,
        enableHaptics,
        autoScratchpad,
        leechThreshold,
        leechAction,
        backupReminderDays,
        lastBackupAt: existing?.lastBackupAt,

        updatedAt: Date.now(),
      };

      await db.settings.put(updatedSettings);
      onThemeChange(theme);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleResetDefaults = () => {
    setRequestRetention(DEFAULT_SETTINGS.requestRetention);
    setAlgorithm(DEFAULT_SETTINGS.algorithm);
    setDayRolloverHour(DEFAULT_SETTINGS.dayRolloverHour);
    setLearningStepsStr(DEFAULT_SETTINGS.learningSteps.join(', '));
    setRelearningStepsStr(DEFAULT_SETTINGS.relearningSteps.join(', '));

    setCjkFontStyle(DEFAULT_SETTINGS.cjkFontStyle);
    setCardFontSize(DEFAULT_SETTINGS.cardFontSize);
    setReadingDisplayMode(DEFAULT_SETTINGS.readingDisplayMode);
    setAutoPlayAudio(DEFAULT_SETTINGS.autoPlayAudio);
    setTtsSpeed(DEFAULT_SETTINGS.ttsSpeed);
    setHandedness(DEFAULT_SETTINGS.handedness);
    setEnableHaptics(DEFAULT_SETTINGS.enableHaptics);
    setAutoScratchpad(DEFAULT_SETTINGS.autoScratchpad);
    setLeechThreshold(DEFAULT_SETTINGS.leechThreshold);
    setLeechAction(DEFAULT_SETTINGS.leechAction);
    setBackupReminderDays(DEFAULT_SETTINGS.backupReminderDays);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div
        className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <Sliders className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Preferences & Power Settings</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Typography, Audio, Ergonomics & Spaced Repetition</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-6 flex-1 text-sm">
          {/* Section 1: Appearance & Theme */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Appearance Theme
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setTheme('light');
                  onThemeChange('light');
                }}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  theme === 'light'
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-950'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                <Sun className="w-4 h-4" /> Light
              </button>
              <button
                type="button"
                onClick={() => {
                  setTheme('dark');
                  onThemeChange('dark');
                }}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  theme === 'dark'
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-950'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                <Moon className="w-4 h-4" /> Dark
              </button>
              <button
                type="button"
                onClick={() => {
                  setTheme('oled');
                  onThemeChange('oled');
                }}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  theme === 'oled'
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-950'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                <Monitor className="w-4 h-4" /> OLED Black
              </button>
            </div>
          </div>

          {/* Section 2: Typography & Card Display */}
          <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 space-y-4">
            <div className="flex items-center gap-1.5 text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              <Type className="w-3.5 h-3.5 text-indigo-600" /> Typography & Reading Display
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                  CJK Script Font Style
                </label>
                <select
                  value={cjkFontStyle}
                  onChange={(e) => setCjkFontStyle(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-semibold"
                >
                  <option value="sans">Modern Gothic / Sans-Serif</option>
                  <option value="serif">Traditional Mincho / Song / Serif</option>
                  <option value="textbook">Textbook / Kaisho (Learner Stroke Order)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                  Card Font Sizing
                </label>
                <div className="grid grid-cols-4 gap-1">
                  {(['sm', 'md', 'lg', 'xl'] as const).map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setCardFontSize(size)}
                      className={`py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                        cardFontSize === size
                          ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400'
                          : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {size.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                Furigana / Reading Display Mode
              </label>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setReadingDisplayMode('tap')}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    readingDisplayMode === 'tap'
                      ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/60 font-semibold'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}
                >
                  <div className="font-bold text-gray-900 dark:text-gray-100">Tap to Reveal</div>
                  <div className="text-[10px] text-gray-400">Front hidden; tap to peek</div>
                </button>

                <button
                  type="button"
                  onClick={() => setReadingDisplayMode('always')}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    readingDisplayMode === 'always'
                      ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/60 font-semibold'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}
                >
                  <div className="font-bold text-gray-900 dark:text-gray-100">Always Visible</div>
                  <div className="text-[10px] text-gray-400">Shown directly on front</div>
                </button>

                <button
                  type="button"
                  onClick={() => setReadingDisplayMode('back_only')}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    readingDisplayMode === 'back_only'
                      ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/60 font-semibold'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}
                >
                  <div className="font-bold text-gray-900 dark:text-gray-100">Back Side Only</div>
                  <div className="text-[10px] text-gray-400">Strict reading recall</div>
                </button>
              </div>
            </div>
          </div>

          {/* Section 3: Audio & Speech */}
          <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 space-y-4">
            <div className="flex items-center gap-1.5 text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              <Volume2 className="w-3.5 h-3.5 text-indigo-600" /> Audio & Speech Automation
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                  Auto-Play Audio / TTS
                </label>
                <select
                  value={autoPlayAudio}
                  onChange={(e) => setAutoPlayAudio(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-semibold"
                >
                  <option value="off">Off (Manual tap only)</option>
                  <option value="front">Front Side Only</option>
                  <option value="back">Back Side Only (Default)</option>
                  <option value="both">Both Front and Back</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                    TTS Speech Rate: <span className="text-indigo-600 font-bold">{ttsSpeed.toFixed(2)}x</span>
                  </label>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.05"
                  value={ttsSpeed}
                  onChange={(e) => setTtsSpeed(parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                  <span>0.5x (Slow)</span>
                  <span>1.0x (Normal)</span>
                  <span>1.5x (Fast)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Hardware & Ergonomics */}
          <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 space-y-4">
            <div className="flex items-center gap-1.5 text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              <Smartphone className="w-3.5 h-3.5 text-indigo-600" /> Touch & Hardware Ergonomics
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                  Handedness Orientation
                </label>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setHandedness('right')}
                    className={`py-2 rounded-lg border font-semibold ${
                      handedness === 'right'
                        ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400'
                        : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    Right
                  </button>
                  <button
                    type="button"
                    onClick={() => setHandedness('left')}
                    className={`py-2 rounded-lg border font-semibold ${
                      handedness === 'left'
                        ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400'
                        : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    Left
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                  Auto-Open Scratchpad
                </label>
                <select
                  value={autoScratchpad}
                  onChange={(e) => setAutoScratchpad(e.target.value as any)}
                  className="w-full px-2.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-semibold"
                >
                  <option value="production_only">Production Cards Only</option>
                  <option value="always">Always Open</option>
                  <option value="off">Off (Manual Pen Icon)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                  Haptic Feedback
                </label>
                <label className="flex items-center gap-2 p-2 border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableHaptics}
                    onChange={(e) => setEnableHaptics(e.target.checked)}
                    className="accent-indigo-600 rounded"
                  />
                  <span>Vibrate on Ratings</span>
                </label>
              </div>
            </div>
          </div>

          {/* Section 5: Leech Mitigation & Scheduling */}
          <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 space-y-4">
            <div className="flex items-center gap-1.5 text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Leech Mitigation & Backups
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                  Leech Lapse Threshold
                </label>
                <input
                  type="number"
                  min="2"
                  max="12"
                  value={leechThreshold}
                  onChange={(e) => setLeechThreshold(parseInt(e.target.value) || 4)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                  Leech Action
                </label>
                <select
                  value={leechAction}
                  onChange={(e) => setLeechAction(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-semibold"
                >
                  <option value="flag">Bookmark Red Flag</option>
                  <option value="suspend">Auto-Suspend Card</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                  Backup Reminder (Days)
                </label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={backupReminderDays}
                  onChange={(e) => setBackupReminderDays(parseInt(e.target.value) || 7)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-semibold"
                />
              </div>
            </div>
          </div>

          {/* Section 6: Algorithm & Day Boundary */}
          <div className="space-y-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Spaced Repetition Algorithm
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAlgorithm('fsrs6')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  algorithm === 'fsrs6'
                    ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/50'
                    : 'border-gray-200 dark:border-gray-800'
                }`}
              >
                <div className="font-bold text-gray-900 dark:text-gray-100 text-xs">
                  FSRS-6 (Recommended)
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  21-parameter DSR model; 20-30% fewer reviews
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAlgorithm('sm2')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  algorithm === 'sm2'
                    ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/50'
                    : 'border-gray-200 dark:border-gray-800'
                }`}
              >
                <div className="font-bold text-gray-900 dark:text-gray-100 text-xs">
                  Classic SM-2
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  Legacy SuperMemo-2 ease factor model
                </div>
              </button>
            </div>

            {algorithm === 'fsrs6' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Target Retention: <span className="text-indigo-600 font-bold">{Math.round(requestRetention * 100)}%</span>
                  </label>
                  <span className="text-xs text-gray-400">
                    {requestRetention === 0.90 ? 'Default Optimal' : requestRetention > 0.90 ? 'Rapid Exam Profile' : 'Relaxed Maintenance'}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.80"
                  max="0.97"
                  step="0.01"
                  value={requestRetention}
                  onChange={(e) => setRequestRetention(parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Logical Day Rollover Boundary (Hour)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={dayRolloverHour}
                  onChange={(e) => setDayRolloverHour(parseInt(e.target.value) || 0)}
                  className="w-24 px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-semibold text-center outline-none"
                />
                <span className="text-xs text-gray-500">
                  Default 4 (04:00 AM). Midnight reviews count towards the previous study day.
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Learning Steps (minutes)
                </label>
                <input
                  type="text"
                  value={learningStepsStr}
                  onChange={(e) => setLearningStepsStr(e.target.value)}
                  placeholder="1, 10"
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Relearning Steps (minutes)
                </label>
                <input
                  type="text"
                  value={relearningStepsStr}
                  onChange={(e) => setRelearningStepsStr(e.target.value)}
                  placeholder="10"
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm outline-none font-mono"
                />
              </div>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset Defaults
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 font-medium text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => handleSave()}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs shadow-md shadow-indigo-500/20 flex items-center gap-1.5"
            >
              <Save className="w-4 h-4" /> Save Preferences
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
