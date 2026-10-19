/**
 * Manual Snapshot Archive (.pocketsrs) Import / Export Engine
 * Packages full database states and OPFS media assets into a single compressed ZIP archive
 * for offline AirDrop, Quick Share, or local disk backups (PRD §2.3 Option 3).
 */

import * as fflate from 'fflate';
import {
  exportLocalSyncPayload,
  mergeSyncPayload,
  type SyncPayload,
  type MergeResult,
} from './logMerger';
import { getMediaBlobFromOPFS, saveMediaToOPFS } from '../storage/opfs';
import { getDeviceId } from '../storage/db';

export async function exportSnapshotArchive(): Promise<{ blob: Blob; filename: string }> {
  const payload = await exportLocalSyncPayload(getDeviceId());
  const files: Record<string, Uint8Array> = {};

  // 1. Serialize payload JSON
  const payloadJson = JSON.stringify(payload, null, 2);
  files['payload.json'] = new TextEncoder().encode(payloadJson);

  // 2. Bundle all referenced media assets from OPFS
  for (const hash of payload.mediaManifest) {
    const mediaBlob = await getMediaBlobFromOPFS(hash);
    if (mediaBlob) {
      const arrayBuffer = await mediaBlob.arrayBuffer();
      files[`media/${hash}`] = new Uint8Array(arrayBuffer);
    }
  }

  // 3. Compress into .pocketsrs ZIP archive
  const zipData = fflate.zipSync(files, { level: 6 });
  const blob = new Blob([zipData as any], { type: 'application/octet-stream' });
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `PocketSRS_Backup_${dateStr}.pocketsrs`;

  return { blob, filename };
}

export async function importSnapshotArchive(
  archiveData: ArrayBuffer | Uint8Array
): Promise<MergeResult> {
  const uint8 = archiveData instanceof Uint8Array ? archiveData : new Uint8Array(archiveData);
  const unzipped = fflate.unzipSync(uint8);

  // 1. Locate and parse payload.json
  const payloadBytes = unzipped['payload.json'];
  if (!payloadBytes) {
    throw new Error('Invalid .pocketsrs archive: payload.json not found');
  }

  const payloadStr = new TextDecoder().decode(payloadBytes);
  const payload: SyncPayload = JSON.parse(payloadStr);

  // 2. Stream bundled media into OPFS
  for (const [filepath, fileBytes] of Object.entries(unzipped)) {
    if (filepath.startsWith('media/') && fileBytes.byteLength > 0) {
      await saveMediaToOPFS(fileBytes);
    }
  }

  // 3. Merge database records with deterministic FSRS replay
  return await mergeSyncPayload(payload);
}
