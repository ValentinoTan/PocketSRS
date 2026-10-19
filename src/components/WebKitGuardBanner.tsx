/**
 * iOS WebKit Standalone Guard Banner (PRD §2.2)
 * Alerts users on iOS/iPadOS Safari to install PocketSRS to their Home Screen,
 * exempting IndexedDB and OPFS storage from WebKit's 7-day ITP cache eviction policy.
 */

import React, { useState, useEffect } from 'react';
import { Smartphone, Share, X, ShieldAlert } from 'lucide-react';

export const WebKitGuardBanner: React.FC = () => {
  const [shouldShow, setShouldShow] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const isStandalone =
      (window.navigator as any).standalone ||
      window.matchMedia('(display-mode: standalone)').matches;
    const isDismissed = localStorage.getItem('pocketsrs_dismiss_webkit_guard');

    if (isIOS && !isStandalone && !isDismissed) {
      setShouldShow(true);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem('pocketsrs_dismiss_webkit_guard', 'true');
    setShouldShow(false);
  };

  if (!shouldShow) return null;

  return (
    <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-900 dark:text-amber-200 px-4 py-2.5 text-xs flex items-center justify-between gap-3 animate-fadeIn">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <div>
          <span className="font-bold">iOS 7-Day Storage Guard: </span>
          <span>
            Tap <Share className="w-3.5 h-3.5 inline mx-0.5 text-indigo-600 dark:text-indigo-400" />{' '}
            <strong>Share</strong> → <strong>Add to Home Screen</strong> to protect your flashcard database from WebKit's automatic 7-day eviction.
          </span>
        </div>
      </div>
      <button
        onClick={handleDismiss}
        className="p-1 hover:bg-amber-500/20 rounded-lg text-amber-700 dark:text-amber-300 shrink-0"
        title="Dismiss warning"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
