/**
 * Peer-to-Peer Local Wi-Fi Synchronization Channel (WebRTC DataChannel)
 * Implements two-step mutual QR handshake, content-addressed differential media sync,
 * and 5-second AP Isolation timeout detection.
 */

import QRCode from 'qrcode';
import {
  exportLocalSyncPayload,
  mergeSyncPayload,
  type SyncPayload,
  type MergeResult,
} from './logMerger';
import { getMediaBlobFromOPFS, saveMediaToOPFS } from '../storage/opfs';
import { getDeviceId } from '../storage/db';

export type SyncRole = 'initiator' | 'receiver';
export type SyncConnectionState =
  | 'idle'
  | 'generating_offer'
  | 'waiting_for_answer'
  | 'connecting'
  | 'connected'
  | 'syncing_data'
  | 'syncing_media'
  | 'completed'
  | 'failed';

export interface P2PProgress {
  state: SyncConnectionState;
  message: string;
  mediaProcessed?: number;
  mediaTotal?: number;
  mergeResult?: MergeResult;
}

export class P2PChannelManager {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private apIsolationTimer: any = null;
  private onProgressCallback?: (progress: P2PProgress) => void;
  private role: SyncRole = 'initiator';

  constructor(onProgress?: (progress: P2PProgress) => void) {
    this.onProgressCallback = onProgress;
  }

  private updateStatus(state: SyncConnectionState, message: string, extra?: Partial<P2PProgress>) {
    this.onProgressCallback?.({
      state,
      message,
      ...extra,
    });
  }

  /**
   * Generates a QR Code Data URL from any payload string.
   */
  public static async generateQRDataUrl(text: string): Promise<string> {
    return QRCode.toDataURL(text, {
      errorCorrectionLevel: 'L',
      margin: 2,
      width: 320,
    });
  }

  /**
   * Device A (Initiator): Creates an RTCPeerConnection, creates an SDP Offer,
   * gathers candidates into a self-contained bundle, and returns the Offer string.
   */
  public async createOffer(): Promise<string> {
    this.role = 'initiator';
    this.updateStatus('generating_offer', 'Preparing WebRTC P2P offer...');

    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    this.dc = this.pc.createDataChannel('pocketsrs_sync', {
      ordered: true,
    });
    this.setupDataChannel(this.dc);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // Wait for ICE candidates gathering to finish so the SDP is completely self-contained
    await this.waitForIceGathering(this.pc);

    this.updateStatus('waiting_for_answer', 'Offer ready. Scan with Device B or copy code.');
    return JSON.stringify(this.pc.localDescription);
  }

  /**
   * Device B (Receiver): Accepts Offer string, sets RemoteDescription,
   * creates an SDP Answer, gathers candidates, and returns the Answer string.
   */
  public async acceptOfferAndCreateAnswer(offerJsonStr: string): Promise<string> {
    this.role = 'receiver';
    this.updateStatus('connecting', 'Processing offer and generating answer...');

    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    this.pc.ondatachannel = (event) => {
      this.dc = event.channel;
      this.setupDataChannel(this.dc);
    };

    const offerDesc = JSON.parse(offerJsonStr);
    await this.pc.setRemoteDescription(new RTCSessionDescription(offerDesc));

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    await this.waitForIceGathering(this.pc);

    this.startApIsolationWatchdog();
    return JSON.stringify(this.pc.localDescription);
  }

  /**
   * Device A (Initiator): Accepts Answer string from Device B to complete handshake.
   */
  public async acceptAnswer(answerJsonStr: string): Promise<void> {
    if (!this.pc) throw new Error('PeerConnection not initialized');

    this.updateStatus('connecting', 'Connecting P2P channel...');
    const answerDesc = JSON.parse(answerJsonStr);
    await this.pc.setRemoteDescription(new RTCSessionDescription(answerDesc));

    this.startApIsolationWatchdog();
  }

  /**
   * Waits for complete ICE gathering so connection tokens are 100% self-contained.
   */
  private waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const checkState = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };

      pc.addEventListener('icegatheringstatechange', checkState);
      // Fallback timeout after 3.5 seconds
      setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }, 3500);
    });
  }

  /**
   * Detects Access Point (AP) Isolation if connection does not establish within 8 seconds.
   */
  private startApIsolationWatchdog() {
    this.clearApIsolationWatchdog();
    this.apIsolationTimer = setTimeout(() => {
      if (this.dc?.readyState !== 'open') {
        this.updateStatus(
          'failed',
          'Connection timed out (Possible Wi-Fi AP Isolation). Use Google Drive or Manual Snapshot.'
        );
      }
    }, 8000);
  }

  private clearApIsolationWatchdog() {
    if (this.apIsolationTimer) {
      clearTimeout(this.apIsolationTimer);
      this.apIsolationTimer = null;
    }
  }

  /**
   * Configures WebRTC DataChannel message handlers and synchronization state machine.
   */
  private setupDataChannel(channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';

    channel.onopen = async () => {
      this.clearApIsolationWatchdog();
      this.updateStatus('connected', 'Encrypted P2P channel established. Exchanging data...');

      try {
        // Step 1: Send local database sync payload
        this.updateStatus('syncing_data', 'Exporting local state...');
        const payload = await exportLocalSyncPayload(getDeviceId());
        channel.send(JSON.stringify({ type: 'SYNC_PAYLOAD', payload }));
      } catch (err: any) {
        this.updateStatus('failed', `Data export failed: ${err.message}`);
      }
    };

    channel.onmessage = async (event) => {
      try {
        if (typeof event.data === 'string') {
          const message = JSON.parse(event.data);

          if (message.type === 'SYNC_PAYLOAD') {
            this.updateStatus('syncing_data', 'Merging remote review logs & cards...');
            const mergeResult = await mergeSyncPayload(message.payload as SyncPayload);

            // Step 2: Request missing media assets if any
            if (mergeResult.missingMediaHashes.length > 0) {
              this.updateStatus(
                'syncing_media',
                `Requesting ${mergeResult.missingMediaHashes.length} missing media assets...`,
                {
                  mediaProcessed: 0,
                  mediaTotal: mergeResult.missingMediaHashes.length,
                  mergeResult,
                }
              );
              channel.send(
                JSON.stringify({
                  type: 'REQUEST_MEDIA',
                  hashes: mergeResult.missingMediaHashes,
                })
              );
            } else {
              // No missing media needed
              channel.send(JSON.stringify({ type: 'SYNC_COMPLETE' }));
              this.updateStatus('completed', 'Sync completed successfully!', { mergeResult });
            }
          } else if (message.type === 'REQUEST_MEDIA') {
            // Send requested media blobs to peer
            const requestedHashes: string[] = message.hashes;
            for (let i = 0; i < requestedHashes.length; i++) {
              const hash = requestedHashes[i];
              const blob = await getMediaBlobFromOPFS(hash);
              if (blob) {
                const buffer = await blob.arrayBuffer();
                // Send metadata header first
                channel.send(
                  JSON.stringify({
                    type: 'MEDIA_ITEM_START',
                    hash,
                    mimeType: blob.type,
                    size: buffer.byteLength,
                  })
                );
                // Send binary payload
                channel.send(buffer);
              }
            }
            channel.send(JSON.stringify({ type: 'MEDIA_SEND_DONE' }));
          } else if (message.type === 'MEDIA_ITEM_START') {
            this.pendingMediaItem = {
              hash: message.hash,
              mimeType: message.mimeType,
              size: message.size,
            };
          } else if (message.type === 'MEDIA_SEND_DONE' || message.type === 'SYNC_COMPLETE') {
            this.updateStatus('completed', 'Sync and media transfer completed!');
          }
        } else if (event.data instanceof ArrayBuffer && this.pendingMediaItem) {
          // Received binary media data
          const { hash, mimeType } = this.pendingMediaItem;
          await saveMediaToOPFS(new Uint8Array(event.data), mimeType);
          this.pendingMediaItem = null;
        }
      } catch (err: any) {
        console.error('P2P message processing error:', err);
        this.updateStatus('failed', `Sync error: ${err.message}`);
      }
    };

    channel.onclose = () => {
      this.clearApIsolationWatchdog();
    };

    channel.onerror = (err) => {
      console.error('Data channel error:', err);
      this.updateStatus('failed', 'WebRTC DataChannel connection failed.');
    };
  }

  private pendingMediaItem: { hash: string; mimeType: string; size: number } | null = null;

  /**
   * Cleans up all peer connection resources.
   */
  public close() {
    this.clearApIsolationWatchdog();
    if (this.dc) {
      try {
        this.dc.close();
      } catch {}
      this.dc = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }
  }
}
