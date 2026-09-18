import { snapdom } from '@zumer/snapdom';

import {
  bitmapToPngBlob,
  blobToBitmap,
  deleteAtlas,
  listAtlasKeys,
  loadAtlas,
  saveAtlas,
} from './atlasStore';
import { getActiveLayout, type CatalogLayout } from './catalogLayout';
import { applyTicketCssVars } from './ticketPresets';

export type CellBox = { x: number; y: number; w: number; h: number };

export type TicketGeometry = {
  cells: CellBox[];
  dpr: number;
  /** Exact card width used when measuring / capturing (must match live tickets). */
  cardWidth: number;
};

export type AtlasSource = 'ram' | 'idb' | 'snap' | 'empty';

type AtlasEntry = {
  key: string;
  bitmaps: Map<number, ImageBitmap>;
  geometry: TicketGeometry;
};

const ATLAS_VERSION = 'v6-align';
const SHEET_COLS = 10;

const ramCache = new Map<string, AtlasEntry>();

let active: AtlasEntry | null = null;
let warmPromise: Promise<AtlasSource> | null = null;
let warmPromiseKey: string | null = null;
let buildGen = 0;

export function getCellBitmap(n: number): ImageBitmap | undefined {
  return active?.bitmaps.get(n);
}

export function cellAtlasSize(): number {
  return active?.bitmaps.size ?? 0;
}

export function getTicketGeometry(): TicketGeometry | null {
  return active?.geometry ?? null;
}

export function getActiveAtlasKey(): string | null {
  return active?.key ?? null;
}

export function ramAtlasCount(): number {
  return ramCache.size;
}

/** Exact cardWidth — no quantization (that caused DOM/canvas cell shift). */
export function atlasCacheKey(layout: CatalogLayout = getActiveLayout()): string {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const m = layout.metrics;
  return [
    ATLAS_VERSION,
    m.id,
    `cw=${layout.cardWidth}`,
    `dpr=${dpr}`,
    `h=${m.cardHeight}`,
    `cellH=${m.cellHeight}`,
    `num=${m.numberFontSize}/${m.numberLineHeight}`,
    `meta=${m.metaFontSize}`,
    `sep=${m.separatorWidth}x${m.separatorHeight}`,
    `padY=${m.bodyPaddingY}`,
  ].join('|');
}

export function resetCellAtlasRam(key?: string): void {
  buildGen += 1;
  if (key) {
    const entry = ramCache.get(key);
    if (entry) {
      for (const b of entry.bitmaps.values()) b.close();
      ramCache.delete(key);
      if (active?.key === key) active = null;
    }
  } else {
    for (const entry of ramCache.values()) {
      for (const b of entry.bitmaps.values()) b.close();
    }
    ramCache.clear();
    active = null;
  }
  warmPromise = null;
  warmPromiseKey = null;
}

export function clearCellAtlas(): void {
  const key = active?.key ?? warmPromiseKey;
  resetCellAtlasRam();
  if (key) void deleteAtlas(key);
}

const SNAP_OPTS = {
  embedFonts: true,
  outerTransforms: true,
  outerShadows: false,
  backgroundColor: '#FFFFFF' as const,
  fast: true,
  cache: 'soft' as const,
  compress: true,
  scale: 1,
  burst: true,
};

function snapCss(css: number, dpr: number): number {
  return Math.round(css * dpr) / dpr;
}

function yieldToMain(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sched?.yield) return sched.yield();
  return new Promise((r) => setTimeout(r, 0));
}

function activate(entry: AtlasEntry): void {
  active = entry;
  ramCache.set(entry.key, entry);
}

export function warmCellAtlas(
  host: HTMLElement,
  onProgress?: (ready: number, source: AtlasSource) => void
): Promise<AtlasSource> {
  const key = atlasCacheKey();
  const hit = ramCache.get(key);
  if (hit && hit.bitmaps.size === 60) {
    activate(hit);
    onProgress?.(60, 'ram');
    return Promise.resolve('ram');
  }

  if (warmPromise && warmPromiseKey === key) return warmPromise;

  buildGen += 1;
  const gen = buildGen;
  warmPromiseKey = key;
  warmPromise = buildAtlas(host, key, gen, onProgress).finally(() => {
    if (warmPromiseKey === key) {
      warmPromise = null;
      warmPromiseKey = null;
    }
  });
  return warmPromise;
}

async function buildAtlas(
  host: HTMLElement,
  key: string,
  gen: number,
  onProgress?: (ready: number, source: AtlasSource) => void
): Promise<AtlasSource> {
  const stored = await loadAtlas(key);
  if (gen !== buildGen) return 'empty';
  if (stored) {
    try {
      // Reject stale geometry that doesn't match current card width.
      const layout = getActiveLayout();
      const storedCw = stored.geometry.cardWidth;
      if (typeof storedCw !== 'number' || storedCw !== layout.cardWidth) {
        await deleteAtlas(key);
      } else {
        const bitmaps = new Map<number, ImageBitmap>();
        for (let i = 0; i < 60; i++) {
          if (gen !== buildGen) return 'empty';
          bitmaps.set(i + 1, await blobToBitmap(stored.blobs[i]!));
          onProgress?.(bitmaps.size, 'idb');
        }
        activate({ key, bitmaps, geometry: stored.geometry });
        return 'idb';
      }
    } catch {
      await deleteAtlas(key);
    }
  }

  if (gen !== buildGen) return 'empty';

  const layout = getActiveLayout();
  const m = layout.metrics;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const captureWidth = layout.cardWidth;

  prepareFactoryHost(host);
  applyTicketCssVars(host, m);

  const measure = buildMeasureTicket(captureWidth, layout.cardHeight);
  host.appendChild(measure.root);
  await document.fonts.ready;
  void measure.root.offsetWidth;

  const cardRect = measure.root.getBoundingClientRect();
  const measuredRaw = measure.cells.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      x: r.left - cardRect.left,
      y: r.top - cardRect.top,
      w: r.width,
      h: r.height,
    };
  });

  // Snap boxes to device pixels so sprite size === draw size.
  const measured = measuredRaw.map((b) => ({
    x: snapCss(b.x, dpr),
    y: snapCss(b.y, dpr),
    w: snapCss(b.w, dpr),
    h: snapCss(b.h, dpr),
  }));

  const cellW = measured[0]?.w ?? m.cellHeight;
  const cellH = measured[0]?.h ?? m.cellHeight;
  const geometry: TicketGeometry = { dpr, cells: measured, cardWidth: captureWidth };
  measure.root.remove();

  if (gen !== buildGen) return 'empty';
  await yieldToMain();

  // Sheet cells are locked to the same snapped box as live tickets.
  const sheet = document.createElement('div');
  sheet.className = 'cellAtlasSheet';
  sheet.style.cssText = [
    'display:grid',
    `grid-template-columns:repeat(${SHEET_COLS}, ${cellW}px)`,
    `grid-template-rows:repeat(6, ${cellH}px)`,
    'gap:0',
    'margin:0',
    'padding:0',
    'background:#FFFFFF',
    'box-sizing:border-box',
    'font-family:MB-Onest, Onest, system-ui, sans-serif',
    '-webkit-font-smoothing:antialiased',
    'text-rendering:geometricPrecision',
  ].join(';');

  for (let n = 1; n <= 60; n++) {
    const cell = document.createElement('span');
    cell.className = 'ticketCard__cell';
    // Override flex leftovers — exact same box as measured live cell.
    cell.style.cssText = [
      `box-sizing:border-box`,
      `width:${cellW}px`,
      `height:${cellH}px`,
      `flex:0 0 ${cellW}px`,
      `margin:0`,
      `min-width:0`,
      `background:#FFFFFF`,
      `font-size:${m.numberFontSize}px`,
      `font-weight:700`,
      `line-height:${m.numberLineHeight}px`,
      `color:#704F4F`,
      `display:flex`,
      `align-items:center`,
      `justify-content:center`,
      `white-space:nowrap`,
      `overflow:hidden`,
    ].join(';');
    cell.textContent = String(n);
    sheet.appendChild(cell);
  }

  host.appendChild(sheet);
  void sheet.offsetWidth;

  if (gen !== buildGen) return 'empty';
  await yieldToMain();

  const sheetCssW = SHEET_COLS * cellW;
  const sheetCssH = 6 * cellH;

  const sheetCanvas = await snapdom.toCanvas(sheet, {
    ...SNAP_OPTS,
    width: sheetCssW,
    height: sheetCssH,
    dpr,
  });

  sheet.remove();
  if (gen !== buildGen) return 'empty';
  await yieldToMain();

  // Crop against *actual* raster size (SnapDOM may round differently than our math).
  const bitmaps = new Map<number, ImageBitmap>();
  const scaleX = sheetCanvas.width / sheetCssW;
  const scaleY = sheetCanvas.height / sheetCssH;
  const pxW = Math.max(1, Math.round(cellW * scaleX));
  const pxH = Math.max(1, Math.round(cellH * scaleY));

  for (let n = 1; n <= 60; n++) {
    if (gen !== buildGen) {
      for (const b of bitmaps.values()) b.close();
      return 'empty';
    }
    const i = n - 1;
    const col = i % SHEET_COLS;
    const row = Math.floor(i / SHEET_COLS);
    const sx = Math.round(col * cellW * scaleX);
    const sy = Math.round(row * cellH * scaleY);
    const safeW = Math.min(pxW, sheetCanvas.width - sx);
    const safeH = Math.min(pxH, sheetCanvas.height - sy);
    bitmaps.set(n, await createImageBitmap(sheetCanvas, sx, sy, safeW, safeH));
    onProgress?.(bitmaps.size, 'snap');
    if (n % 10 === 0) await yieldToMain();
  }

  if (gen !== buildGen) {
    for (const b of bitmaps.values()) b.close();
    return 'empty';
  }

  activate({ key, bitmaps, geometry });
  onProgress?.(60, 'snap');

  try {
    const blobs: Blob[] = [];
    for (let n = 1; n <= 60; n++) {
      blobs.push(await bitmapToPngBlob(bitmaps.get(n)!));
      if (n % 10 === 0) await yieldToMain();
    }
    if (gen !== buildGen) return 'snap';
    const ok = await saveAtlas({ key, geometry, blobs });
    if (!ok) console.warn('[atlas] IndexedDB save failed for', key);
  } catch (err) {
    console.warn('[atlas] persist failed', err);
  }

  return 'snap';
}

function buildMeasureTicket(cardWidth: number, cardHeight: number): {
  root: HTMLElement;
  cells: HTMLElement[];
} {
  const root = document.createElement('div');
  root.className = 'ticketCard ticketCard_factory';
  root.style.position = 'relative';
  root.style.visibility = 'visible';
  root.style.width = `${cardWidth}px`;
  root.style.height = `${cardHeight}px`;
  root.style.filter = 'none';
  root.style.boxShadow = 'none';

  const header = document.createElement('div');
  header.className = 'ticketCard__header';
  const winEl = document.createElement('span');
  winEl.className = 'ticketCard__win';
  const idEl = document.createElement('span');
  idEl.className = 'ticketCard__id';
  idEl.textContent = '0001';
  header.append(winEl, idEl);

  const body = document.createElement('div');
  body.className = 'ticketCard__body';
  const cells: HTMLElement[] = [];
  for (let i = 0; i < 6; i++) {
    const cell = document.createElement('span');
    cell.className = 'ticketCard__cell';
    cell.textContent = String(i + 1);
    body.appendChild(cell);
    cells.push(cell);
  }
  root.append(header, body);
  return { root, cells };
}

function prepareFactoryHost(host: HTMLElement): void {
  const s = host.style;
  s.position = 'fixed';
  s.left = '-10000px';
  s.top = '0';
  s.pointerEvents = 'none';
  s.opacity = '1';
  s.zIndex = '-1';
  host.setAttribute('aria-hidden', 'true');
  host.replaceChildren();
}

export async function debugAtlasKeys(): Promise<string[]> {
  return listAtlasKeys();
}
