/**
 * Origin Private File System (OPFS) Content-Addressed Media Asset Manager
 * Stores media blobs (audio MP3, images, stroke SVG) indexed by SHA-256 hash.
 */

// Memory and IndexedDB fallback for environments where OPFS is restricted
const memoryCache = new Map<string, Blob>();

/**
 * Computes hexadecimal SHA-256 hash for binary data.
 */
export async function computeSHA256(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bufferSource = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bufferSource as any);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Gets the OPFS root directory handle.
 */
async function getOPFSRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
    try {
      return await navigator.storage.getDirectory();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Saves a media blob to OPFS indexed by its SHA-256 hash.
 */
export async function saveMediaToOPFS(
  data: Blob | ArrayBuffer | Uint8Array,
  mimeType: string = 'application/octet-stream'
): Promise<{ hash: string; size: number }> {
  let blob: Blob;
  let uint8Data: Uint8Array;

  if (data instanceof Blob) {
    blob = data;
    const arrayBuffer = await data.arrayBuffer();
    uint8Data = new Uint8Array(arrayBuffer);
  } else if (data instanceof Uint8Array) {
    uint8Data = data;
    blob = new Blob([data as any], { type: mimeType });
  } else {
    uint8Data = new Uint8Array(data);
    blob = new Blob([data], { type: mimeType });
  }

  const hash = await computeSHA256(uint8Data);
  const root = await getOPFSRoot();

  if (root) {
    try {
      const mediaDir = await root.getDirectoryHandle('media', { create: true });
      const fileHandle = await mediaDir.getFileHandle(hash, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(uint8Data as any);
      await writable.close();
      return { hash, size: blob.size };
    } catch (err) {
      console.warn('OPFS write failed, falling back to in-memory store:', err);
    }
  }

  // Fallback
  memoryCache.set(hash, blob);
  return { hash, size: blob.size };
}

/**
 * Retrieves a media blob by its SHA-256 hash.
 */
export async function getMediaBlobFromOPFS(hash: string): Promise<Blob | null> {
  const root = await getOPFSRoot();

  if (root) {
    try {
      const mediaDir = await root.getDirectoryHandle('media', { create: false });
      const fileHandle = await mediaDir.getFileHandle(hash, { create: false });
      return await fileHandle.getFile();
    } catch {
      // File not in OPFS, check fallback
    }
  }

  return memoryCache.get(hash) || null;
}

/**
 * Creates an Object URL for quick audio/image playback from OPFS.
 */
export async function getMediaUrlFromOPFS(hash: string): Promise<string | null> {
  const blob = await getMediaBlobFromOPFS(hash);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

/**
 * Checks whether a media asset is already stored in OPFS.
 */
export async function hasMediaInOPFS(hash: string): Promise<boolean> {
  const root = await getOPFSRoot();
  if (root) {
    try {
      const mediaDir = await root.getDirectoryHandle('media', { create: false });
      await mediaDir.getFileHandle(hash, { create: false });
      return true;
    } catch {
      return memoryCache.has(hash);
    }
  }
  return memoryCache.has(hash);
}

/**
 * Streams an array of media files into OPFS in 50-card batches as per PRD spec.
 */
export async function streamMediaBatchToOPFS(
  files: { filename: string; data: Uint8Array; mimeType: string }[],
  onProgress?: (processed: number, total: number) => void
): Promise<Map<string, string>> {
  const filenameToHashMap = new Map<string, string>();
  const BATCH_SIZE = 50;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (file) => {
        const { hash } = await saveMediaToOPFS(file.data, file.mimeType);
        filenameToHashMap.set(file.filename, hash);
      })
    );
    onProgress?.(Math.min(i + BATCH_SIZE, files.length), files.length);
  }

  return filenameToHashMap;
}
