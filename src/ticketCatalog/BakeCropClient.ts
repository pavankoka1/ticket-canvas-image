import type { CropSheetError, CropSheetRequest, CropSheetResponse } from './bakeCrop.worker';
import { CARD_HEIGHT, CARD_WIDTH } from './layout';

type Pending = {
  resolve: (bitmaps: ImageBitmap[]) => void;
  reject: (err: Error) => void;
};

/**
 * Worker that crops a transferred sheet ImageBitmap into per-ticket bitmaps.
 * SnapDOM itself cannot run here (needs DOM) — this only offsloads the crop CPU.
 */
export class BakeCropClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();

  start(): void {
    if (this.worker) return;
    this.worker = new Worker(new URL('./bakeCrop.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (ev: MessageEvent<CropSheetResponse | CropSheetError>) => {
      const msg = ev.data;
      const wait = this.pending.get(msg.id);
      if (!wait) return;
      this.pending.delete(msg.id);
      if (msg.type === 'cropSheet') wait.resolve(msg.bitmaps);
      else wait.reject(new Error(msg.message));
    };
    this.worker.onerror = (err) => {
      for (const [, wait] of this.pending) {
        wait.reject(new Error(err.message || 'bake crop worker error'));
      }
      this.pending.clear();
    };
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, wait] of this.pending) {
      wait.reject(new Error('bake crop worker stopped'));
    }
    this.pending.clear();
  }

  async cropSheet(sheet: ImageBitmap, count: number, cols: number, dpr: number): Promise<ImageBitmap[]> {
    this.start();
    if (!this.worker) {
      // Fallback: crop on main thread.
      return cropOnMain(sheet, count, cols, dpr);
    }

    const id = ++this.seq;
    return new Promise<ImageBitmap[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const req: CropSheetRequest = {
        type: 'cropSheet',
        id,
        sheet,
        count,
        cols,
        cardW: CARD_WIDTH,
        cardH: CARD_HEIGHT,
        dpr,
      };
      this.worker!.postMessage(req, [sheet]);
    });
  }
}

async function cropOnMain(
  sheet: ImageBitmap,
  count: number,
  cols: number,
  dpr: number
): Promise<ImageBitmap[]> {
  const sw = Math.round(CARD_WIDTH * dpr);
  const sh = Math.round(CARD_HEIGHT * dpr);
  const bitmaps = await Promise.all(
    Array.from({ length: count }, (_, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const sx = Math.round(col * CARD_WIDTH * dpr);
      const sy = Math.round(row * CARD_HEIGHT * dpr);
      return createImageBitmap(sheet, sx, sy, sw, sh);
    })
  );
  sheet.close();
  return bitmaps;
}

let shared: BakeCropClient | null = null;

export function getBakeCropClient(): BakeCropClient {
  if (!shared) shared = new BakeCropClient();
  return shared;
}
