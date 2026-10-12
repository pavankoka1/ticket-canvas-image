import { snapdom } from '@zumer/snapdom';

import { getBakeCropClient } from './BakeCropClient';
import { CARD_HEIGHT, CARD_WIDTH } from './layout';

export type SheetCaptureResult = {
  bitmaps: ImageBitmap[];
};

const SNAP_OPTS = {
  embedFonts: false,
  outerTransforms: true,
  outerShadows: false,
  backgroundColor: 'transparent' as const,
  fast: true,
  cache: 'soft' as const,
  compress: true,
  scale: 1,
};

/**
 * SnapDOM on the main thread (DOM required), then crop in a worker.
 */
export async function captureSheetToBitmaps(
  sheet: HTMLElement,
  count: number,
  cols: number,
  dpr = window.devicePixelRatio || 1
): Promise<SheetCaptureResult> {
  const rows = Math.max(1, Math.ceil(count / cols));
  const cssW = cols * CARD_WIDTH;
  const cssH = rows * CARD_HEIGHT;

  void sheet.offsetWidth;

  // Yield once before the expensive SnapDOM so scroll/input can flush.
  await yieldToMain();

  const canvas = await snapdom.toCanvas(sheet, {
    ...SNAP_OPTS,
    width: cssW,
    height: cssH,
    dpr,
  });

  if (canvas.width <= 1 || canvas.height <= 1) {
    throw new Error('captureSheetToBitmaps: empty sheet canvas');
  }

  // Hand the sheet raster to the worker — cropping stays off the UI thread.
  const sheetBitmap = await createImageBitmap(canvas);
  await yieldToMain();
  const bitmaps = await getBakeCropClient().cropSheet(sheetBitmap, count, cols, dpr);
  return { bitmaps };
}

/** Let the browser paint / handle input between bake steps. */
export function yieldToMain(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sched?.yield) return sched.yield();
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}
