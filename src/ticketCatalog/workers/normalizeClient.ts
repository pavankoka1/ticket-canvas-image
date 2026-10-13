/**
 * Main-thread client for normalize.worker. Falls back to synchronous on-main
 * normalisation when Workers / OffscreenCanvas / transferToImageBitmap are
 * unavailable, so the atlas build path never depends on the worker existing.
 */

export type Rgb = { r: number; g: number; b: number };

export type NormalizeInput = {
  n: number;
  /** Raw SnapDOM canvas (opaque white face). */
  src: HTMLCanvasElement;
  wantW: number;
  wantH: number;
  shiftY: number;
  glyph: Rgb;
};

type WorkerResult = { id: number; results: { n: number; bitmap: ImageBitmap }[] };

/**
 * Worker is DISABLED by default. It lives in the pixel-critical sprite path, so
 * until its output is confirmed byte-identical to the main-thread path on every
 * target OS, we run normalisation on main (which is the exact proven math). Flip
 * this on to A/B test the worker once cell/id sprites are confirmed stable.
 */
let workerEnabled = false;
export function setNormalizeWorkerEnabled(on: boolean): void {
  workerEnabled = on;
}

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, (r: { n: number; bitmap: ImageBitmap }[]) => void>();

function supported(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function" &&
    // transferToImageBitmap exists on OffscreenCanvas where we do the work
    typeof (OffscreenCanvas.prototype as unknown as { transferToImageBitmap?: unknown })
      .transferToImageBitmap === "function"
  );
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./normalize.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<WorkerResult>) => {
      const cb = pending.get(e.data.id);
      if (cb) {
        pending.delete(e.data.id);
        cb(e.data.results);
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

/** Synchronous main-thread fallback (identical math to the worker). */
function normalizeOnMain(item: NormalizeInput): ImageBitmap | Promise<ImageBitmap> {
  const out = document.createElement("canvas");
  out.width = item.wantW;
  out.height = item.wantH;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) return createImageBitmap(item.src);
  ctx.imageSmoothingEnabled = false;
  const sw = Math.min(item.src.width, item.wantW);
  const sh = Math.min(item.src.height, item.wantH);
  ctx.drawImage(item.src, 0, 0, sw, sh, 0, item.shiftY, sw, sh);
  const img = ctx.getImageData(0, 0, item.wantW, item.wantH);
  const d = img.data;
  const F = item.glyph;
  const dr = 255 - F.r;
  const dg = 255 - F.g;
  const db = 255 - F.b;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const cr = dr > 0 ? (255 - d[i]!) / dr : 0;
    const cg = dg > 0 ? (255 - d[i + 1]!) / dg : 0;
    const cb = db > 0 ? (255 - d[i + 2]!) / db : 0;
    let cov = Math.max(cr, cg, cb);
    cov = cov < 0 ? 0 : cov > 1 ? 1 : cov;
    d[i] = F.r;
    d[i + 1] = F.g;
    d[i + 2] = F.b;
    d[i + 3] = Math.round(cov * 255);
  }
  ctx.putImageData(img, 0, 0);
  return createImageBitmap(out);
}

/**
 * Normalise a batch of raw SnapDOM captures into transparent, ink-shifted
 * sprites. Uses the worker when available; otherwise does the work on main.
 */
export async function normalizeBatch(
  items: NormalizeInput[],
): Promise<Map<number, ImageBitmap>> {
  const out = new Map<number, ImageBitmap>();
  if (items.length === 0) return out;

  const w = workerEnabled && supported() ? getWorker() : null;
  if (!w) {
    for (const item of items) out.set(item.n, await normalizeOnMain(item));
    return out;
  }

  // Convert each raw canvas to a transferable ImageBitmap on main (cheap,
  // off-thread decode), then let the worker do the getImageData/un-matte loop.
  const bitmaps = await Promise.all(items.map((it) => createImageBitmap(it.src)));
  const payload = items.map((it, i) => ({
    n: it.n,
    bitmap: bitmaps[i]!,
    wantW: it.wantW,
    wantH: it.wantH,
    shiftY: it.shiftY,
    glyph: it.glyph,
  }));

  const id = ++seq;
  const results = await new Promise<{ n: number; bitmap: ImageBitmap }[]>(
    (resolve) => {
      pending.set(id, resolve);
      w.postMessage({ id, items: payload }, bitmaps);
    },
  );
  for (const r of results) out.set(r.n, r.bitmap);
  return out;
}
