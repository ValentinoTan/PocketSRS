/**
 * Unified Multi-Device Synchronization & Optimization Modal (PRD §2.3, §5.4 & Phase 3)
 * Provides P2P WebRTC 2-step QR sync, Google Drive AppData sync,
 * .pocketsrs manual snapshot import/export, and on-device FSRS-6 parameter optimization.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Wifi,
  Cloud,
  FileArchive,
  Cpu,
  QrCode,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  Download,
  Upload,
  Calendar,
  CheckCircle2,
  Sliders,
} from 'lucide-react';
import {
  P2PChannelManager,
  type P2PProgress,
  type SyncRole,
} from '../sync/p2pChannel';
import { driveClient } from '../sync/driveClient';
import { exportSnapshotArchive, importSnapshotArchive } from '../sync/snapshot';
import {
  optimizeParametersLocal,
  type OptimizationProgress,
  type OptimizationResult,
} from '../engine/optimizerWorker';
import { redistributeBacklog } from '../engine/fsrs';
import { db, DEFAULT_SETTINGS, type UserSettingsRecord } from '../storage/db';

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SyncTab = 'p2p' | 'gdrive' | 'snapshot' | 'optimizer' | 'backlog';

export const SyncModal: React.FC<SyncModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<SyncTab>('p2p');

  // P2P State
  const [p2pRole, setP2pRole] = useState<SyncRole>('initiator');
  const [offerToken, setOfferToken] = useState<string>('');
  const [offerQrUrl, setOfferQrUrl] = useState<string>('');
  const [answerToken, setAnswerToken] = useState<string>('');
  const [answerQrUrl, setAnswerQrUrl] = useState<string>('');
  const [inputToken, setInputToken] = useState<string>('');
  const [p2pProgress, setP2pProgress] = useState<P2PProgress>({
    state: 'idle',
    message: 'Ready to connect.',
  });
  const [copiedToken, setCopiedToken] = useState<boolean>(false);
  const p2pManagerRef = useRef<P2PChannelManager | null>(null);

  // Google Drive State
  const [gdriveToken, setGdriveToken] = useState<string>(
    localStorage.getItem('pocketsrs_gdrive_token') || ''
  );
  const [gdriveLoading, setGdriveLoading] = useState<boolean>(false);
  const [gdriveStatus, setGdriveStatus] = useState<string | null>(null);
  const [gdriveError, setGdriveError] = useState<string | null>(null);

  // Snapshot State
  const [snapshotLoading, setSnapshotLoading] = useState<boolean>(false);
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null);

  // Optimizer State
  const [logCount, setLogCount] = useState<number>(0);
  const [optimizing, setOptimizing] = useState<boolean>(false);
  const [optProgress, setOptProgress] = useState<OptimizationProgress | null>(null);
  const [optResult, setOptResult] = useState<OptimizationResult | null>(null);

  // Backlog Balancer State
  const [overdueCount, setOverdueCount] = useState<number>(0);
  const [recoveryDays, setRecoveryDays] = useState<number>(5);
  const [backlogStatus, setBacklogStatus] = useState<string | null>(null);

  // Load database metrics on modal open
  useEffect(() => {
    if (!isOpen) return;

    db.revlog.count().then(setLogCount);

    const now = new Date();
    now.setHours(4, 0, 0, 0);
    db.cards
      .filter((c) => !c.deletedAt && c.state === 2 && new Date(c.due) < now)
      .count()
      .then(setOverdueCount);
  }, [isOpen]);

  // Cleanup P2P channel on close
  useEffect(() => {
    return () => {
      p2pManagerRef.current?.close();
      p2pManagerRef.current = null;
    };
  }, []);

  // --- P2P Handshake Actions ---
  const handleStartP2POffer = async () => {
    p2pManagerRef.current?.close();
    const manager = new P2PChannelManager((progress) => setP2pProgress(progress));
    p2pManagerRef.current = manager;

    try {
      const offer = await manager.createOffer();
      setOfferToken(offer);
      const qr = await P2PChannelManager.generateQRDataUrl(offer);
      setOfferQrUrl(qr);
    } catch (err: any) {
      setP2pProgress({ state: 'failed', message: `Offer creation failed: ${err.message}` });
    }
  };

  const handleAcceptOfferGenerateAnswer = async () => {
    if (!inputToken.trim()) return;

    p2pManagerRef.current?.close();
    const manager = new P2PChannelManager((progress) => setP2pProgress(progress));
    p2pManagerRef.current = manager;

    try {
      const answer = await manager.acceptOfferAndCreateAnswer(inputToken.trim());
      setAnswerToken(answer);
      const qr = await P2PChannelManager.generateQRDataUrl(answer);
      setAnswerQrUrl(qr);
      setInputToken('');
    } catch (err: any) {
      setP2pProgress({ state: 'failed', message: `Answer generation failed: ${err.message}` });
    }
  };

  const handleApplyAnswerToInitiator = async () => {
    if (!inputToken.trim() || !p2pManagerRef.current) return;
    try {
      await p2pManagerRef.current.acceptAnswer(inputToken.trim());
      setInputToken('');
    } catch (err: any) {
      setP2pProgress({ state: 'failed', message: `Failed to connect with Answer: ${err.message}` });
    }
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  // --- Google Drive Actions ---
  const handleDriveSync = async () => {
    if (!gdriveToken.trim()) {
      setGdriveError('Please enter a Google OAuth access token');
      return;
    }

    setGdriveLoading(true);
    setGdriveError(null);
    setGdriveStatus('Connecting to Google Drive appDataFolder...');

    try {
      driveClient.setAccessToken(gdriveToken.trim());
      const result = await driveClient.performSync();
      setGdriveStatus(
        `Sync successful! Updated: ${result.decksUpdated} decks, ${result.notesUpdated} notes, ${result.cardsReplayed} cards replayed, ${result.revlogsMerged} revlogs merged.`
      );
    } catch (err: any) {
      setGdriveError(err.message || 'Google Drive sync failed');
      setGdriveStatus(null);
    } finally {
      setGdriveLoading(false);
    }
  };

  // --- Manual Snapshot Actions ---
  const handleExportSnapshot = async () => {
    setSnapshotLoading(true);
    setSnapshotStatus('Packaging database and OPFS media...');
    try {
      const { blob, filename } = await exportSnapshotArchive();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setSnapshotStatus(`Exported ${filename} successfully!`);
    } catch (err: any) {
      setSnapshotStatus(`Export error: ${err.message}`);
    } finally {
      setSnapshotLoading(false);
    }
  };

  const handleImportSnapshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSnapshotLoading(true);
    setSnapshotStatus('Extracting and merging snapshot archive...');
    try {
      const buffer = await file.arrayBuffer();
      const result = await importSnapshotArchive(buffer);
      setSnapshotStatus(
        `Import completed! Merged: ${result.notesUpdated} notes, ${result.cardsReplayed} cards replayed, ${result.revlogsMerged} review logs.`
      );
    } catch (err: any) {
      setSnapshotStatus(`Import failed: ${err.message}`);
    } finally {
      setSnapshotLoading(false);
      e.target.value = '';
    }
  };

  // --- Optimizer Actions ---
  const handleRunOptimizer = async () => {
    setOptimizing(true);
    setOptProgress(null);
    setOptResult(null);

    try {
      const revlogs = await db.revlog.toArray();
      const settings = (await db.settings.get('global')) || undefined;
      const currentWeights = settings?.fsrsWeights;

      const result = await optimizeParametersLocal(
        revlogs,
        currentWeights,
        (progress) => setOptProgress(progress)
      );

      setOptResult(result);
    } catch (err: any) {
      alert(`Optimization failed: ${err.message}`);
    } finally {
      setOptimizing(false);
    }
  };

  const handleApplyWeights = async () => {
    if (!optResult) return;
    const settings = (await db.settings.get('global')) || { ...DEFAULT_SETTINGS };

    settings.fsrsWeights = optResult.weights;
    settings.learningSteps = optResult.recommendedLearningSteps;
    settings.updatedAt = Date.now();
    await db.settings.put(settings);

    alert('Optimized FSRS-6 weights and learning steps successfully applied to your study profile!');
  };

  // --- Backlog Balancer Action ---
  const handleRedistributeBacklog = async () => {
    const result = await redistributeBacklog(undefined, recoveryDays);
    if (result.redistributedCount > 0) {
      setBacklogStatus(
        `Successfully redistributed ${result.redistributedCount} overdue cards over ${recoveryDays} days (~${result.cardsPerDay} cards/day).`
      );
      setOverdueCount(0);
    } else {
      setBacklogStatus('No overdue review cards found to redistribute.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-gray-900 w-full max-w-3xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="p-2 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-2xl">
              <Wifi className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-gray-100 text-base">
                Sync Coordinator & Optimizer
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Local-first synchronization, snapshot backups, and on-device ML fitting
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 px-6 text-xs font-semibold overflow-x-auto">
          <button
            onClick={() => setActiveTab('p2p')}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-colors shrink-0 ${
              activeTab === 'p2p'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            <QrCode className="w-4 h-4" />
            <span>P2P Wi-Fi Sync</span>
          </button>

          <button
            onClick={() => setActiveTab('gdrive')}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-colors shrink-0 ${
              activeTab === 'gdrive'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            <Cloud className="w-4 h-4" />
            <span>Google Drive</span>
          </button>

          <button
            onClick={() => setActiveTab('snapshot')}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-colors shrink-0 ${
              activeTab === 'snapshot'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            <FileArchive className="w-4 h-4" />
            <span>Manual Snapshot</span>
          </button>

          <button
            onClick={() => setActiveTab('optimizer')}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-colors shrink-0 ${
              activeTab === 'optimizer'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>FSRS Optimizer</span>
          </button>

          <button
            onClick={() => setActiveTab('backlog')}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-colors shrink-0 ${
              activeTab === 'backlog'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Backlog Balancer</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm">
          {/* TAB 1: P2P Wi-Fi Sync */}
          {activeTab === 'p2p' && (
            <div className="space-y-6">
              {/* Role Toggle */}
              <div className="flex p-1 bg-gray-100 dark:bg-gray-800 rounded-2xl max-w-sm mx-auto text-xs font-semibold">
                <button
                  onClick={() => {
                    setP2pRole('initiator');
                    setOfferToken('');
                    setOfferQrUrl('');
                  }}
                  className={`flex-1 py-2 rounded-xl transition-all ${
                    p2pRole === 'initiator'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500'
                  }`}
                >
                  Device A (Initiator)
                </button>
                <button
                  onClick={() => {
                    setP2pRole('receiver');
                    setAnswerToken('');
                    setAnswerQrUrl('');
                  }}
                  className={`flex-1 py-2 rounded-xl transition-all ${
                    p2pRole === 'receiver'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500'
                  }`}
                >
                  Device B (Joiner)
                </button>
              </div>

              {/* Status Banner */}
              <div
                className={`p-3.5 rounded-2xl text-xs flex items-center justify-between border ${
                  p2pProgress.state === 'completed'
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                    : p2pProgress.state === 'failed'
                    ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
                    : 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-100 dark:border-indigo-900/40 text-indigo-800 dark:text-indigo-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <RefreshCw
                    className={`w-4 h-4 ${
                      ['connecting', 'syncing_data', 'syncing_media'].includes(p2pProgress.state)
                        ? 'animate-spin'
                        : ''
                    }`}
                  />
                  <span className="font-medium">{p2pProgress.message}</span>
                </div>
                {p2pProgress.mediaTotal && (
                  <span className="font-mono text-[11px]">
                    Media: {p2pProgress.mediaProcessed || 0} / {p2pProgress.mediaTotal}
                  </span>
                )}
              </div>

              {/* Device A UI */}
              {p2pRole === 'initiator' && (
                <div className="space-y-4">
                  {!offerToken ? (
                    <div className="text-center py-6">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                        Step 1: Generate an encrypted WebRTC offer token and QR code on this device.
                      </p>
                      <button
                        onClick={handleStartP2POffer}
                        className="px-6 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-md shadow-indigo-500/20 text-xs transition-all"
                      >
                        Generate Offer QR
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                      <div className="flex flex-col items-center p-4 bg-gray-50 dark:bg-gray-800/40 rounded-2xl border border-gray-200 dark:border-gray-800">
                        {offerQrUrl && (
                          <img
                            src={offerQrUrl}
                            alt="Offer QR"
                            className="w-48 h-48 rounded-xl bg-white p-2 shadow-sm"
                          />
                        )}
                        <span className="text-[11px] text-gray-500 mt-2">
                          Scan this QR with Device B
                        </span>
                        <button
                          onClick={() => handleCopyText(offerToken)}
                          className="mt-2 text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-semibold"
                        >
                          {copiedToken ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          {copiedToken ? 'Token Copied!' : 'Copy Offer Token'}
                        </button>
                      </div>

                      <div className="space-y-3">
                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                          Step 2: Paste Device B's Answer Token
                        </label>
                        <textarea
                          value={inputToken}
                          onChange={(e) => setInputToken(e.target.value)}
                          placeholder="Paste answer token from Device B here..."
                          rows={4}
                          className="w-full p-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-mono"
                        />
                        <button
                          onClick={handleApplyAnswerToInitiator}
                          disabled={!inputToken.trim()}
                          className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs shadow-md transition-all"
                        >
                          Complete Handshake & Start Sync
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Device B UI */}
              {p2pRole === 'receiver' && (
                <div className="space-y-4">
                  {!answerToken ? (
                    <div className="space-y-3 max-w-lg mx-auto">
                      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 text-center">
                        Step 1: Paste Device A's Offer Token
                      </label>
                      <textarea
                        value={inputToken}
                        onChange={(e) => setInputToken(e.target.value)}
                        placeholder="Paste offer token from Device A here..."
                        rows={4}
                        className="w-full p-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-mono"
                      />
                      <button
                        onClick={handleAcceptOfferGenerateAnswer}
                        disabled={!inputToken.trim()}
                        className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs shadow-md transition-all"
                      >
                        Generate Answer Token & QR
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center p-4 bg-gray-50 dark:bg-gray-800/40 rounded-2xl border border-gray-200 dark:border-gray-800 max-w-sm mx-auto">
                      {answerQrUrl && (
                        <img
                          src={answerQrUrl}
                          alt="Answer QR"
                          className="w-48 h-48 rounded-xl bg-white p-2 shadow-sm"
                        />
                      )}
                      <span className="text-[11px] text-gray-500 mt-2 text-center">
                        Scan or copy this Answer back to Device A to complete the encrypted tunnel.
                      </span>
                      <button
                        onClick={() => handleCopyText(answerToken)}
                        className="mt-3 px-4 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-semibold text-xs flex items-center gap-1.5"
                      >
                        {copiedToken ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedToken ? 'Copied!' : 'Copy Answer Token'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Google Drive AppData Sync */}
          {activeTab === 'gdrive' && (
            <div className="space-y-5 max-w-lg mx-auto">
              <div className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40 text-xs text-indigo-900 dark:text-indigo-200 space-y-1">
                <div className="font-bold">Private Google Drive appDataFolder</div>
                <p>
                  Syncs directly to your hidden, sandboxed personal cloud folder. No third-party servers or recurring subscriptions.
                </p>
              </div>

              <div className="space-y-3">
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Google OAuth Access Token
                </label>
                <input
                  type="password"
                  value={gdriveToken}
                  onChange={(e) => setGdriveToken(e.target.value)}
                  placeholder="ya29.a0..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-mono"
                />
                <span className="text-[11px] text-gray-400">
                  Tokens are saved exclusively in your browser's private local storage.
                </span>
              </div>

              {gdriveStatus && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs rounded-xl flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{gdriveStatus}</span>
                </div>
              )}

              {gdriveError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 text-xs rounded-xl flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{gdriveError}</span>
                </div>
              )}

              <button
                onClick={handleDriveSync}
                disabled={gdriveLoading || !gdriveToken.trim()}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs shadow-md transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${gdriveLoading ? 'animate-spin' : ''}`} />
                <span>{gdriveLoading ? 'Synchronizing with Drive...' : 'Sync with Google Drive'}</span>
              </button>
            </div>
          )}

          {/* TAB 3: Manual Snapshot Import / Export */}
          {activeTab === 'snapshot' && (
            <div className="space-y-6 max-w-lg mx-auto">
              <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 text-xs text-gray-600 dark:text-gray-400">
                A single-click compressed archive (<code className="text-indigo-600 font-bold">.pocketsrs</code>) containing your full database, review logs, and referenced audio/image media for AirDrop or local disk backup.
              </div>

              {snapshotStatus && (
                <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-300 text-xs rounded-xl">
                  {snapshotStatus}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  onClick={handleExportSnapshot}
                  disabled={snapshotLoading}
                  className="p-5 rounded-2xl border border-gray-200 dark:border-gray-800 hover:border-indigo-500 bg-white dark:bg-gray-900 text-left transition-all group flex flex-col justify-between h-36"
                >
                  <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 w-fit group-hover:scale-105 transition-transform">
                    <Download className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-gray-900 dark:text-gray-100 text-xs">
                      Export .pocketsrs
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      Download full compressed backup
                    </div>
                  </div>
                </button>

                <label className="p-5 rounded-2xl border border-gray-200 dark:border-gray-800 hover:border-indigo-500 bg-white dark:bg-gray-900 text-left transition-all group flex flex-col justify-between h-36 cursor-pointer">
                  <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400 w-fit group-hover:scale-105 transition-transform">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-gray-900 dark:text-gray-100 text-xs">
                      Import .pocketsrs
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      Restore from backup archive
                    </div>
                  </div>
                  <input
                    type="file"
                    accept=".pocketsrs,.zip"
                    onChange={handleImportSnapshot}
                    disabled={snapshotLoading}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}

          {/* TAB 4: On-Device FSRS Parameter Optimizer */}
          {activeTab === 'optimizer' && (
            <div className="space-y-6">
              <div className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40 text-xs text-indigo-950 dark:text-indigo-200 flex items-center justify-between">
                <div>
                  <span className="font-bold">Local Review Log History: </span>
                  <span>{logCount} review events recorded</span>
                  <p className="text-gray-500 dark:text-gray-400 mt-0.5">
                    FSRS-6 fits 21 cognitive parameters to your unique retention curve. Recommended: ≥1,000 reviews for best personalization.
                  </p>
                </div>
                <button
                  onClick={handleRunOptimizer}
                  disabled={optimizing}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold shadow-md transition-all shrink-0"
                >
                  {optimizing ? 'Training...' : 'Optimize Now'}
                </button>
              </div>

              {optProgress && (
                <div className="space-y-2 p-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                  <div className="flex justify-between text-xs font-semibold">
                    <span>
                      Epoch {optProgress.epoch} / {optProgress.totalEpochs}
                    </span>
                    <span className="font-mono">Loss: {optProgress.loss.toFixed(4)}</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-indigo-600 h-2 transition-all duration-200"
                      style={{ width: `${optProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}

              {optResult && (
                <div className="space-y-4 animate-fadeIn p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-900 dark:text-emerald-200">
                      Parameter Training Complete (Log-Loss: {optResult.finalLoss.toFixed(4)})
                    </span>
                    <button
                      onClick={handleApplyWeights}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-all shadow-sm"
                    >
                      Apply Weights
                    </button>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-700 dark:text-gray-300">
                      Recommended Learning Steps:{' '}
                    </span>
                    <span className="font-mono text-emerald-700 dark:text-emerald-300">
                      {optResult.recommendedLearningSteps.join('m, ')}m
                    </span>
                  </div>
                  <div className="font-mono text-[11px] bg-white dark:bg-gray-900 p-2.5 rounded-xl border border-gray-200 dark:border-gray-800 overflow-x-auto">
                    {optResult.weights.map((w) => w.toFixed(4)).join(', ')}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: Backlog Load Balancer */}
          {activeTab === 'backlog' && (
            <div className="space-y-6 max-w-lg mx-auto">
              <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-950 dark:text-amber-200">
                <div className="font-bold flex items-center gap-1.5 mb-1">
                  <Calendar className="w-4 h-4 text-amber-600" />
                  Overdue Backlog Recovery
                </div>
                <span>
                  Redistribute past-due reviews evenly over a recovery window so you can catch up comfortably without review fatigue or algorithm degradation.
                </span>
              </div>

              <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-4">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-500">Currently Overdue Cards:</span>
                  <span className="font-bold text-base text-gray-900 dark:text-gray-100">
                    {overdueCount}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span>Recovery Schedule:</span>
                    <span className="text-indigo-600 font-bold">{recoveryDays} Days</span>
                  </div>
                  <input
                    type="range"
                    min="3"
                    max="14"
                    value={recoveryDays}
                    onChange={(e) => setRecoveryDays(Number(e.target.value))}
                    className="w-full accent-indigo-600"
                  />
                  <div className="flex justify-between text-[11px] text-gray-400">
                    <span>3 days</span>
                    <span>~{Math.ceil(overdueCount / recoveryDays)} cards/day</span>
                    <span>14 days</span>
                  </div>
                </div>

                {backlogStatus && (
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs rounded-xl">
                    {backlogStatus}
                  </div>
                )}

                <button
                  onClick={handleRedistributeBacklog}
                  disabled={overdueCount === 0}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs shadow-md transition-all"
                >
                  Redistribute Backlog ({recoveryDays} Days)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
