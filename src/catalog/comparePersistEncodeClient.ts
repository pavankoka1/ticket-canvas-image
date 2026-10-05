/**
 * Worker-backed PNG encode for compare atlas IDB persist (main-thread fallback).
 */

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<
  number,
  { resolve: (blob: Blob | null) => void; canvas: HTMLCanvasElement }
>();

function encodeOnMain(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./comparePersistEncode.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<{ id: number; buffer?: ArrayBuffer; error?: string }>) => {
      const entry = pending.get(e.data.id);
      if (!entry) return;
      pending.delete(e.data.id);
      if (e.data.buffer) {
        entry.resolve(new Blob([e.data.buffer], { type: "image/png" }));
        return;
      }
      void encodeOnMain(entry.canvas).then(entry.resolve);
    };
    worker.onerror = () => {
      workerBroken = true;
      worker?.terminate();
      worker = null;
      for (const [, entry] of pending) {
        void encodeOnMain(entry.canvas).then(entry.resolve);
      }
      pending.clear();
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

export async function encodeCompareCanvasPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const w = getWorker();
  if (!w) return encodeOnMain(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width < 1 || canvas.height < 1) return encodeOnMain(canvas);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, { resolve, canvas });
    w.postMessage({ id, image });
    window.setTimeout(() => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      void encodeOnMain(entry.canvas).then(resolve);
    }, 15_000);
  });
}
