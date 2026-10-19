/**
 * Screen Wake Lock Hook (PRD §5.4)
 * Uses navigator.wakeLock to keep device display illuminated during active review sessions.
 * Automatically re-acquires lock upon tab re-focus via visibilitychange.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export function useWakeLock(enabled: boolean = true) {
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    setIsSupported('wakeLock' in navigator);
  }, []);

  const requestLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      if (!wakeLockRef.current || wakeLockRef.current.released) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        setIsLocked(true);

        wakeLockRef.current.addEventListener('release', () => {
          setIsLocked(false);
        });
      }
    } catch (err) {
      console.warn('Wake Lock request failed:', err);
      setIsLocked(false);
    }
  }, []);

  const releaseLock = useCallback(() => {
    if (wakeLockRef.current && !wakeLockRef.current.released) {
      try {
        wakeLockRef.current.release();
      } catch {}
      wakeLockRef.current = null;
      setIsLocked(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !isSupported) {
      releaseLock();
      return;
    }

    requestLock();

    // Re-acquire lock when document becomes visible again
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && enabled) {
        requestLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseLock();
    };
  }, [enabled, isSupported, requestLock, releaseLock]);

  return {
    isLocked,
    isSupported,
    requestLock,
    releaseLock,
  };
}
