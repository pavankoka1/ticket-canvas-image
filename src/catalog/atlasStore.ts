/**
 * Best-effort IndexedDB persistence for per-size cell atlases (1…60).
 * One record per stable cache key (preset + cardWidth + dpr + …).
 */

const DB_NAME = "bingo-cell-atlas";
const DB_VERSION = 2;
const STORE = "atlases";

export type StoredGeometry = {
  dpr: number;
  cardWidth: number;
  cellW: number;
  cellH: number;
  cells: { x: number; y: number; w: number; h: number }[];
  /** Vertical device-px shift baked into sprites (mechanism-B fix); debug-only. */
  inkShift?: number;
};

export type StoredAtlas = {
  key: string;
  geometry: StoredGeometry;
  /** PNG blobs for numbers 1…60 (index = n - 1). */
  blobs: Blob[];
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb open failed"));
  });
}

export async function loadAtlas(key: string): Promise<StoredAtlas | null> {
  try {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => {
          const row = req.result as StoredAtlas | undefined;
          if (!row?.blobs || row.blobs.length !== 60 || !row.geometry) {
            resolve(null);
            return;
          }
          resolve(row);
        };
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function saveAtlas(atlas: StoredAtlas): Promise<boolean> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(atlas);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("idb abort"));
      });
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

export async function deleteAtlas(key: string): Promise<void> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
}

export async function listAtlasKeys(): Promise<string[]> {
  try {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAllKeys();
        req.onsuccess = () =>
          resolve((req.result as IDBValidKey[]).map(String));
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function bitmapToPngBlob(bmp: ImageBitmap): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("toBlob failed");
  return blob;
}

export async function blobToBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}
