/**
 * Lock-Screen Media Session Background Audio Keep-Alive (PRD §5.4 & Phase 3)
 * Maintains active browser audio context and displays lock-screen metadata for auditory recall sessions.
 */

export interface MediaSessionCardInfo {
  character: string;
  reading?: string;
  meaning: string;
  deckName?: string;
  artworkUrl?: string;
}

export interface MediaSessionCallbacks {
  onPlay?: () => void;
  onPause?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
}

class MediaSessionManager {
  private audioCtx: AudioContext | null = null;
  private keepAliveOscillator: OscillatorNode | null = null;
  private keepAliveGain: GainNode | null = null;
  private isKeepAliveRunning: boolean = false;

  /**
   * Updates lock-screen media player information with the current flashcard.
   */
  public updateCard(info: MediaSessionCardInfo) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    const artistText = [info.reading, info.meaning].filter(Boolean).join(' • ');

    navigator.mediaSession.metadata = new MediaMetadata({
      title: info.character,
      artist: artistText,
      album: info.deckName || 'PocketSRS Study Session',
      artwork: [
        {
          src: info.artworkUrl || '/pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: info.artworkUrl || '/pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png',
        },
      ],
    });
  }

  /**
   * Binds hardware headphone/lock-screen controls to card study actions.
   */
  public setActionHandlers(callbacks: MediaSessionCallbacks) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    try {
      if (callbacks.onPlay) {
        navigator.mediaSession.setActionHandler('play', () => callbacks.onPlay?.());
      }
      if (callbacks.onPause) {
        navigator.mediaSession.setActionHandler('pause', () => callbacks.onPause?.());
      }
      if (callbacks.onNext) {
        navigator.mediaSession.setActionHandler('nexttrack', () => callbacks.onNext?.());
      }
      if (callbacks.onPrevious) {
        navigator.mediaSession.setActionHandler('previoustrack', () => callbacks.onPrevious?.());
      }
    } catch (err) {
      console.warn('Error setting Media Session action handlers:', err);
    }
  }

  /**
   * Starts a completely inaudible (gain = 0.0001 at 20Hz) Web Audio tone loop
   * that keeps the mobile operating system's audio pipeline active in the background.
   */
  public startKeepAlive() {
    if (this.isKeepAliveRunning) return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      this.audioCtx = new AudioContextClass();
      this.keepAliveOscillator = this.audioCtx.createOscillator();
      this.keepAliveGain = this.audioCtx.createGain();

      // Frequency of 20Hz (at human hearing threshold) and gain near-zero (silent)
      this.keepAliveOscillator.frequency.value = 20;
      this.keepAliveGain.gain.value = 0.00001;

      this.keepAliveOscillator.connect(this.keepAliveGain);
      this.keepAliveGain.connect(this.audioCtx.destination);

      this.keepAliveOscillator.start();
      this.isKeepAliveRunning = true;
    } catch (err) {
      console.warn('Audio keep-alive initialization failed:', err);
    }
  }

  /**
   * Stops background audio keep-alive when leaving the study session.
   */
  public stopKeepAlive() {
    if (!this.isKeepAliveRunning) return;

    try {
      if (this.keepAliveOscillator) {
        this.keepAliveOscillator.stop();
        this.keepAliveOscillator.disconnect();
        this.keepAliveOscillator = null;
      }
      if (this.keepAliveGain) {
        this.keepAliveGain.disconnect();
        this.keepAliveGain = null;
      }
      if (this.audioCtx && this.audioCtx.state !== 'closed') {
        this.audioCtx.close();
        this.audioCtx = null;
      }
      this.isKeepAliveRunning = false;
    } catch (err) {
      console.warn('Error stopping audio keep-alive:', err);
    }
  }
}

export const mediaSessionManager = new MediaSessionManager();
