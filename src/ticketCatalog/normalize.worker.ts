/// <reference lib="webworker" />
/**
 * Off-main-thread sprite normalisation. SnapDOM must run on the main thread
 * (it needs the DOM), but the per-sprite pixel work it produces — crop + vertical
 * shift + un-matte white→transparent — is pure ImageData math. Doing it here
 * keeps the getImageData/putImageData loops (×60 sprites) off the main thread so
 * a warm never janks scroll.
 *
 * Protocol: main posts { id, items: NormalizeItem[] } where each item carries an
 * ImageBitmap of the raw SnapDOM canvas (transferred). We reply
 * { id, results: { n, bitmap }[] } with the finished sprites (transferred back).
 */

type Rgb = { r: number; g: number; b: number };

type NormalizeItem = {
  n: number;
  bitmap: ImageBitmap;
  wantW: number;
  wantH: number;
  shiftY: number;
  glyph: Rgb;
};

type Req = { id: number; items: NormalizeItem[] };

function unmatteFromWhite(
  data: Uint8ClampedArray,
  F: Rgb,
): void {
  const dr = 255 - F.r;
  const dg = 255 - F.g;
  const db = 255 - F.b;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const cr = dr > 0 ? (255 - data[i]!) / dr : 0;
    const cg = dg > 0 ? (255 - data[i + 1]!) / dg : 0;
    const cb = db > 0 ? (255 - data[i + 2]!) / db : 0;
    let cov = Math.max(cr, cg, cb);
    cov = cov < 0 ? 0 : cov > 1 ? 1 : cov;
    data[i] = F.r;
    data[i + 1] = F.g;
    data[i + 2] = F.b;
    data[i + 3] = Math.round(cov * 255);
  }
}

function normalizeOne(item: NormalizeItem): ImageBitmap {
  const { bitmap, wantW, wantH, shiftY, glyph } = item;
  const canvas = new OffscreenCanvas(wantW, wantH);
  const ctx = canvas.getContext("2d", {
    willReadFrequently: true,
  }) as OffscreenCanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  const sw = Math.min(bitmap.width, wantW);
  const sh = Math.min(bitmap.height, wantH);
  ctx.drawImage(bitmap, 0, 0, sw, sh, 0, shiftY, sw, sh);
  bitmap.close();
  const img = ctx.getImageData(0, 0, wantW, wantH);
  unmatteFromWhite(img.data, glyph);
  ctx.putImageData(img, 0, 0);
  return canvas.transferToImageBitmap();
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, items } = e.data;
  const results: { n: number; bitmap: ImageBitmap }[] = [];
  const transfer: Transferable[] = [];
  for (const item of items) {
    const bitmap = normalizeOne(item);
    results.push({ n: item.n, bitmap });
    transfer.push(bitmap);
  }
  (self as unknown as Worker).postMessage({ id, results }, transfer);
};
