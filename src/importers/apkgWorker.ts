import { parseAnkiPackage } from './apkgParser';

/**
 * Web Worker for off-main-thread Anki package decompression & parsing
 * Keeps mobile UI sub-200ms responsive and prevents main-thread freezing.
 */
self.onmessage = async (e: MessageEvent) => {
  const { type, fileBuffer } = e.data;

  if (type === 'PARSE_APKG') {
    try {
      const parsedPackage = await parseAnkiPackage(fileBuffer, (stage, percent) => {
        self.postMessage({ type: 'PROGRESS', stage, percent });
      });

      self.postMessage({
        type: 'SUCCESS',
        pkg: parsedPackage,
      });
    } catch (err: any) {
      self.postMessage({
        type: 'ERROR',
        error: err?.message || String(err),
      });
    }
  }
};
