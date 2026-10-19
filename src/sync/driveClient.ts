/**
 * Google Drive AppData REST API Synchronization Client
 * Synchronizes event-sourced database payloads to a private, sandboxed appDataFolder
 * in the user's personal Google Drive with zero server hosting costs.
 */

import {
  exportLocalSyncPayload,
  mergeSyncPayload,
  type SyncPayload,
  type MergeResult,
} from './logMerger';
import { getDeviceId } from '../storage/db';

export interface DriveSyncStatus {
  isConnected: boolean;
  isSyncing: boolean;
  lastSyncTime: number | null;
  error: string | null;
}

const DRIVE_FILE_NAME = 'pocketsrs_sync.json';
const DRIVE_APP_DATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export class GoogleDriveSyncClient {
  private accessToken: string | null = null;
  private tokenClient: any = null;

  constructor() {
    this.accessToken = localStorage.getItem('pocketsrs_gdrive_token');
  }

  /**
   * Initializes the Google Identity Services (GIS) token client.
   */
  public initGIS(clientId: string, onTokenReceived?: (token: string) => void) {
    if (typeof window === 'undefined' || !(window as any).google?.accounts?.oauth2) {
      return;
    }

    this.tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_APP_DATA_SCOPE,
      callback: (tokenResponse: any) => {
        if (tokenResponse.access_token) {
          this.setAccessToken(tokenResponse.access_token);
          onTokenReceived?.(tokenResponse.access_token);
        }
      },
    });
  }

  /**
   * Prompts user with GIS OAuth consent dialog.
   */
  public requestToken() {
    if (this.tokenClient) {
      this.tokenClient.requestAccessToken({ prompt: 'consent' });
    }
  }

  public setAccessToken(token: string) {
    this.accessToken = token;
    localStorage.setItem('pocketsrs_gdrive_token', token);
  }

  public clearAccessToken() {
    this.accessToken = null;
    localStorage.removeItem('pocketsrs_gdrive_token');
  }

  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  /**
   * Searches for existing pocketsrs_sync.json file in appDataFolder.
   */
  private async findSyncFile(): Promise<{ id: string } | null> {
    if (!this.accessToken) throw new Error('Not authenticated with Google Drive');

    const query = encodeURIComponent(
      `name = '${DRIVE_FILE_NAME}' and 'appDataFolder' in parents and trashed = false`
    );
    const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime)`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        this.clearAccessToken();
        throw new Error('Google Drive authorization expired. Please sign in again.');
      }
      throw new Error(`Drive search failed: ${res.statusText}`);
    }

    const data = await res.json();
    if (data.files && data.files.length > 0) {
      return data.files[0];
    }
    return null;
  }

  /**
   * Downloads remote sync payload from appDataFolder.
   */
  public async downloadRemotePayload(): Promise<SyncPayload | null> {
    const file = await this.findSyncFile();
    if (!file) return null;

    const url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to download remote sync data: ${res.statusText}`);
    }

    return (await res.json()) as SyncPayload;
  }

  /**
   * Uploads unified sync payload to appDataFolder (create or overwrite).
   */
  public async uploadPayload(payload: SyncPayload): Promise<void> {
    if (!this.accessToken) throw new Error('Not authenticated with Google Drive');

    const file = await this.findSyncFile();
    const payloadStr = JSON.stringify(payload);
    const blob = new Blob([payloadStr], { type: 'application/json' });

    if (file) {
      // Overwrite existing file via PATCH
      const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=media`;
      const res = await fetch(uploadUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: blob,
      });

      if (!res.ok) {
        throw new Error(`Failed to update Drive file: ${res.statusText}`);
      }
    } else {
      // Create new file inside appDataFolder via multipart upload
      const metadata = {
        name: DRIVE_FILE_NAME,
        parents: ['appDataFolder'],
      };

      const form = new FormData();
      form.append(
        'metadata',
        new Blob([JSON.stringify(metadata)], { type: 'application/json' })
      );
      form.append('file', blob);

      const uploadUrl =
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: form,
      });

      if (!res.ok) {
        throw new Error(`Failed to create file in appDataFolder: ${res.statusText}`);
      }
    }
  }

  /**
   * Full bidirectional sync workflow:
   * 1. Downloads remote state from appDataFolder
   * 2. Merges remote state into local database
   * 3. Exports unified local state
   * 4. Uploads unified state back to appDataFolder
   */
  public async performSync(): Promise<MergeResult> {
    // 1. Download remote payload
    const remotePayload = await this.downloadRemotePayload();

    let mergeResult: MergeResult = {
      decksUpdated: 0,
      notesUpdated: 0,
      cardsReplayed: 0,
      revlogsMerged: 0,
      missingMediaHashes: [],
      tombstonesPurged: 0,
    };

    // 2. Merge remote if exists
    if (remotePayload) {
      mergeResult = await mergeSyncPayload(remotePayload);
    }

    // 3. Export unified state
    const unifiedPayload = await exportLocalSyncPayload(getDeviceId());

    // 4. Upload to Drive
    await this.uploadPayload(unifiedPayload);

    return mergeResult;
  }
}

export const driveClient = new GoogleDriveSyncClient();
