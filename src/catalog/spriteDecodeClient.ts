/**
 * Worker-backed PNG decode with main-thread fallback.
 */

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, (bitmaps: ImageBitmap[]) => void>();

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./spriteDecode.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<{ id: number; bitmaps?: ImageBitmap[] }>) => {
      const cb = pending.get(e.data.id);
      if (cb && e.data.bitmaps) {
        pending.delete(e.data.id);
        cb(e.data.bitmaps);
      }
    };
    worker.onerror = () => {
      workerBroken = true;
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

async function decodePngOnMain(blobs: readonly Blob[]): Promise<ImageBitmap[]> {
  return Promise.all(
    blobs.map((b) => createImageBitmap(b).catch(() => createImageBitmap(b, { premultiplyAlpha: "none" }))),
  );
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
    const finish = (bitmaps: ImageBitmap[]) => {
      pending.delete(id);
      resolve(bitmaps);
    };
    pending.set(id, finish);
    w.postMessage({ id, buffers }, buffers);
    window.setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      void decodePngOnMain(blobs).then(resolve);
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
  const bitmaps = await decodePngBlobsToBitmaps(blobs);
  return bitmaps.map((bmp) => {
    try {
      return bitmapToCanvas(bmp);
    } catch {
      bmp.close();
      return null;
    }
  });
}
