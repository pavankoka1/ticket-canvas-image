/**
 * Worker-backed PNG decode with main-thread fallback.
 */

import { decodeStoredSpriteBlob } from "./ticketSvgRaster";

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<
  number,
  { resolve: (bitmaps: ImageBitmap[]) => void; blobs: readonly Blob[] }
>();

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./spriteDecode.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (
      e: MessageEvent<{ id: number; bitmaps?: ImageBitmap[]; error?: string }>,
    ) => {
      const entry = pending.get(e.data.id);
      if (!entry) return;
      pending.delete(e.data.id);
      if (e.data.bitmaps?.length) {
        entry.resolve(e.data.bitmaps);
        return;
      }
      void decodePngOnMain(entry.blobs).then(entry.resolve);
    };
    worker.onerror = () => {
      workerBroken = true;
      worker?.terminate();
      worker = null;
      for (const [, entry] of pending) {
        void decodePngOnMain(entry.blobs).then(entry.resolve);
      }
      pending.clear();
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

/** PNG first; fall back to stored SVG / canvas decode when IDB bytes are not valid PNG. */
async function decodeOneBlob(b: Blob): Promise<ImageBitmap> {
  const tryPng = async (): Promise<ImageBitmap> => {
    try {
      return await createImageBitmap(b);
    } catch {
      return await createImageBitmap(b, { premultiplyAlpha: "none" });
    }
  };

  try {
    return await tryPng();
  } catch {
    const decoded = await decodeStoredSpriteBlob(b).catch(() => null);
    if (decoded instanceof ImageBitmap) return decoded;
    if (decoded instanceof HTMLCanvasElement) {
      return await createImageBitmap(decoded);
    }
    throw new Error("sprite blob decode failed");
  }
}

async function decodePngOnMain(blobs: readonly Blob[]): Promise<ImageBitmap[]> {
  return Promise.all(blobs.map((b) => decodeOneBlob(b)));
}

export async function decodePngBlobsToBitmaps(
  blobs: readonly Blob[],
): Promise<ImageBitmap[]> {
  if (blobs.length === 0) return [];
  const w = getWorker();
  if (!w) return decodePngOnMain(blobs);

  const id = ++seq;
  const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()));
  return new Promise((resolve) => {
    pending.set(id, { resolve, blobs });
    w.postMessage({ id, buffers }, buffers);
    window.setTimeout(() => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      void decodePngOnMain(entry.blobs).then(resolve);
    }, 8000);
  });
}

export function bitmapToCanvas(bmp: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return canvas;
}

export async function decodePngBlobsToCanvases(
  blobs: readonly Blob[],
): Promise<(HTMLCanvasElement | null)[]> {
  const out: (HTMLCanvasElement | null)[] = [];
  for (const blob of blobs) {
    try {
      const [bmp] = await decodePngBlobsToBitmaps([blob]);
      out.push(bitmapToCanvas(bmp));
    } catch {
      try {
        const canvas = await decodeStoredSpriteBlob(blob);
        if (canvas instanceof HTMLCanvasElement) out.push(canvas);
        else if (canvas instanceof ImageBitmap) out.push(bitmapToCanvas(canvas));
        else out.push(null);
      } catch {
        out.push(null);
      }
    }
  }
  return out;
}
