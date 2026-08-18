/// <reference lib="webworker" />

export type CropSheetRequest = {
  type: 'cropSheet';
  id: number;
  sheet: ImageBitmap;
  count: number;
  cols: number;
  cardW: number;
  cardH: number;
  dpr: number;
};

export type CropSheetResponse = {
  type: 'cropSheet';
  id: number;
  bitmaps: ImageBitmap[];
};

export type CropSheetError = {
  type: 'cropSheetError';
  id: number;
  message: string;
};

type InMsg = CropSheetRequest;

self.onmessage = async (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.type !== 'cropSheet') return;

  try {
    const { sheet, count, cols, cardW, cardH, dpr, id } = msg;
    const sw = Math.round(cardW * dpr);
    const sh = Math.round(cardH * dpr);
    const crops = await Promise.all(
      Array.from({ length: count }, (_, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const sx = Math.round(col * cardW * dpr);
        const sy = Math.round(row * cardH * dpr);
        return createImageBitmap(sheet, sx, sy, sw, sh);
      })
    );
    sheet.close();
    const out: CropSheetResponse = { type: 'cropSheet', id, bitmaps: crops };
    (self as DedicatedWorkerGlobalScope).postMessage(out, crops);
  } catch (err) {
    try {
      msg.sheet.close();
    } catch {
      /* ignore */
    }
    const out: CropSheetError = {
      type: 'cropSheetError',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as DedicatedWorkerGlobalScope).postMessage(out);
  }
};
