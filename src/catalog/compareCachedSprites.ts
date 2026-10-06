/** Compare-only reusable HTML/CSS sprites. No catalog cache or geometry mutation. */
import { loadSprites, loadSpritesMany, saveSpritesBatch } from './atlasStore';
import { encodeCompareCanvasPng } from './comparePersistEncodeClient';
import { activeDpr, badgeHostDevice, resolveCellBoxModel } from './cellBoxModel';
import { alignCompareStackOrigin, styleCompareTicketDom } from './compareDomAlign';
import { usesSvgMultiplier, usesSvgText } from './compareRenderMode';
import { applySvgMultiplier } from './compareSvgMultiplier';
import { paintSvgAllCompareTicket } from './compareSvgAllPaint';
import { CATALOG_FIGMA_DESKTOP_LOCK } from './catalogFigmaDesktop';
import {
  applySvgText,
  OVERLAY_CLASS,
  stripCompareOverlayHeader,
  stripCompareOverlayHeaderAndCellNumbers,
  stripOverlayInkKeepChrome,
  SVG_FACE_CLASS,
} from './compareSvgText';
import type { CatalogLayout } from './catalogLayout';
import { applyTicketCellLayout, TicketCard } from './ticketCardElement';
import { ensureTicketFontsForLayout } from './ticketFont';
import { applyTicketCssVars } from './ticketPresets';
import { isWinTicket, MULTIPLIER_VALUES, type Ticket } from './tickets';
import { compareGlyphPhaseCount } from './compareGlyphEngine';
import {
  cropGlyphFromSheet,
  glyphWarmMinCardWidthCss,
  stampHeaderGlyphs,
  warmHeaderGlyphPack,
  widenCardForGlyphWarm,
  type HeaderGlyphPack,
} from './compareGlyphAtlas';
import { composeCompareInkPatch, decodeCompareSvgBlob, rasterizeCompareTicketSvg, rasterSvgBlob, type CompareRasterPart } from './ticketSvgRaster';

const TRANSPARENT = `:root{background:transparent!important}.ticketCard,.ticketCard__header,.ticketCard__body{background:none!important;box-shadow:none!important}.ticketCard__cell::before{visibility:hidden!important}`;
type Sprite = { bitmap: HTMLCanvasElement; blob: Blob };
const sprites = new Map<string, Promise<Sprite>>();
const packs = new Map<string, Promise<Pack>>();
type NumberPatch = { sprite: Sprite; dx: number; dy: number };
export type ComparePaintPack = {
  numberPatches: Map<string, NumberPatch>;
  badges: Map<string, Sprite>;
  headerGlyphs?: HeaderGlyphPack;
  catalogChrome: Map<string, Sprite>;
  prefix: string;
};

type Pack = ComparePaintPack;

function prefix(layout: CatalogLayout, dpr: number): string {
  const phases = usesSvgText() ? compareGlyphPhaseCount() : 0;
  return `compare-sprites-v55|html-zoom|whole-css-origin|${usesSvgText() ? 'svg-all' : usesSvgMultiplier() ? 'svg-mult' : 'html-mult'}|glyph-phases-${phases}|isolated-header|kerning-css|number-sheet-patches|badge-no-cell-digits|overlay-dab|disabled-face-no-win|body-pad-snap|defer-idb-persist|sheet-glyphs-badges|${JSON.stringify(layout)}|${dpr}|MB-Onest-700|center-header`;
}

type CssRect = { x: number; y: number; width: number; height: number };
type SheetCropRecord = {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  dx?: number;
  dy?: number;
};
type CompareSheetMeta = {
  source?: Blob;
  sheetUnion: CssRect;
  crops: SheetCropRecord[];
};

type SpritePersistItem = {
  key: string;
  bitmap: HTMLCanvasElement;
  captured: Blob | null;
};

type SheetPersistItem = {
  sheetKey: string;
  sheet: HTMLCanvasElement;
  captured: Blob | null;
  sheetUnion: CssRect;
  crops: SheetCropRecord[];
};

const persistQueue: (SpritePersistItem | SheetPersistItem)[] = [];
const decodedSheets = new Map<string, Promise<HTMLCanvasElement | null>>();
const numberPatchMeta = new Map<string, { dx: number; dy: number }>();
const PERSIST_ENCODE_CHUNK = 8;
let persistDrain: Promise<void> | null = null;

/** Wait until queued compare atlas IDB writes finish (call after warm). */
export async function flushComparePersistQueue(): Promise<void> {
  scheduleFlushPersistQueue();
  while (persistDrain || persistQueue.length > 0) {
    if (persistDrain) await persistDrain;
    else scheduleFlushPersistQueue();
  }
}

function scheduleFlushPersistQueue(): void {
  if (persistDrain) return;
  persistDrain = (async () => {
    try {
      while (persistQueue.length > 0) {
        const batch = persistQueue.splice(0, persistQueue.length);
        const records = [];
        for (let i = 0; i < batch.length; i += PERSIST_ENCODE_CHUNK) {
          const chunk = batch.slice(i, i + PERSIST_ENCODE_CHUNK);
          const encoded = await Promise.all(
            chunk.map(async (item) => {
              if ('sheetKey' in item) {
                const captured = item.captured;
                const png = captured ? null : await encodeCompareCanvasPng(item.sheet);
                if (!png && !captured) throw new Error('Compare sheet persist encode failed');
                const meta: CompareSheetMeta = {
                  sheetUnion: item.sheetUnion,
                  crops: item.crops,
                  ...(captured ? { source: captured } : {}),
                };
                return { key: item.sheetKey, blobs: [png ?? captured!], meta };
              }
              const captured = item.captured;
              const png = captured ? null : await encodeCompareCanvasPng(item.bitmap);
              if (!png && !captured) throw new Error('Compare sprite persist encode failed');
              return {
                key: item.key,
                blobs: [png ?? captured!],
                meta: captured ? { source: captured } : {},
              };
            }),
          );
          records.push(...encoded);
        }
        await saveSpritesBatch(records);
      }
    } finally {
      persistDrain = null;
      if (persistQueue.length > 0) scheduleFlushPersistQueue();
    }
  })();
}

function compareD1ProbeEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(window.location.search).get('d1') === '1';
}

function compareSheetKey(packPrefix: string, kind: string, faceOrFill: string, phase: number): string {
  return `sheet|${packPrefix}|${kind}|${faceOrFill}|${phase}`;
}

function sheetKeyForSprite(spriteKey: string): string | null {
  const badge = '|badge-body|';
  const badgeIdx = spriteKey.indexOf(badge);
  if (badgeIdx >= 0) {
    const pack = spriteKey.slice(0, badgeIdx);
    const badgeKey = spriteKey.slice(badgeIdx + badge.length);
    const face = badgeKey.split('|')[0];
    if (!face) return null;
    return compareSheetKey(pack, 'badge-body', face, 0);
  }
  const inkMatch = spriteKey.match(/^(.*)\|number-ink\|([^|]+)\|(\d+)$/);
  if (inkMatch) {
    const [, pack, disabled, n] = inkMatch;
    const batch = Math.floor((Number(n) - 1) / 6);
    return compareSheetKey(pack!, 'number-ink', disabled!, batch);
  }
  const numberMatch = spriteKey.match(/^(.*)\|number-patch\|([^|]+)\|([^|]+)\|(\d+)$/);
  if (numberMatch) {
    const [, pack, , face, n] = numberMatch;
    const batch = Math.floor((Number(n) - 1) / 6);
    return compareSheetKey(pack!, 'number-opaque', face!, batch);
  }
  const glyphMatch = spriteKey.match(/^(.*)\|(glyph-id|glyph-amt)\|([^|]+)\|[^|]+\|(\d+)\|iso$/);
  if (!glyphMatch) return null;
  const [, pack, kind, fill, phase] = glyphMatch;
  return compareSheetKey(pack!, kind!, fill!, Number(phase));
}

function numberPatchSpriteKey(packPrefix: string, disabled: boolean, face: string, n: number): string {
  return `${packPrefix}|number-patch|${disabled}|${face}|${n}`;
}

function numberWarmDisabled(face: 'normal' | 'gold' | 'disabled'): boolean {
  return face === 'disabled';
}

function isCompareSheetMeta(meta: unknown): meta is CompareSheetMeta {
  return Boolean(
    meta &&
      typeof meta === 'object' &&
      'crops' in meta &&
      Array.isArray((meta as CompareSheetMeta).crops) &&
      'sheetUnion' in meta,
  );
}

function blobIsSvg(blob: Blob): boolean {
  const t = blob.type;
  return t.includes('svg') || t.includes('xml');
}

function compareSheetDecodePreferPng(): boolean {
  const ua = navigator.userAgent;
  const webkit = /AppleWebKit/.test(ua);
  const chromium = /Chrom(e|ium)/.test(ua) || /Edg\//.test(ua) || /OPR\//.test(ua);
  return webkit && !chromium;
}

async function decodeCompareSvgBlobWithTimeout(
  blob: Blob,
  timeoutMs = 12_000,
): Promise<HTMLCanvasElement | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      decodeCompareSvgBlob(blob).catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function decodeStoredBlobToCanvas(blob: Blob): Promise<HTMLCanvasElement | null> {
  if (blobIsSvg(blob)) {
    return compareSheetDecodePreferPng()
      ? decodeCompareSvgBlobWithTimeout(blob)
      : decodeCompareSvgBlob(blob).catch(() => null);
  }
  try {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bmp.close();
      return null;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return canvas;
  } catch {
    return decodeCompareSvgBlob(blob).catch(() => null);
  }
}

async function decodeStoredSheet(
  sheetKey: string,
  stored: { blobs: Blob[]; meta: unknown },
): Promise<HTMLCanvasElement | null> {
  let pending = decodedSheets.get(sheetKey);
  if (!pending) {
    const meta = isCompareSheetMeta(stored.meta) ? stored.meta : null;
    const svg = meta?.source instanceof Blob ? meta.source : null;
    const blob = stored.blobs[0];
    pending = (async () => {
      if (compareSheetDecodePreferPng() && blob) {
        const fromPng = await decodeStoredBlobToCanvas(blob);
        if (fromPng && fromPng.width > 0 && fromPng.height > 0) return fromPng;
      }
      if (svg) {
        const fromSvg = compareSheetDecodePreferPng()
          ? await decodeCompareSvgBlobWithTimeout(svg)
          : await decodeCompareSvgBlob(svg).catch(() => null);
        if (fromSvg && fromSvg.width > 0 && fromSvg.height > 0) return fromSvg;
      }
      if (blob) return decodeStoredBlobToCanvas(blob);
      return null;
    })();
    decodedSheets.set(sheetKey, pending);
  }
  return pending;
}

async function loadSpriteFromSheet(spriteKey: string, dpr: number): Promise<Sprite | null> {
  const sheetKey = sheetKeyForSprite(spriteKey);
  if (!sheetKey) return null;
  const stored = await loadSprites(sheetKey);
  const blob = stored?.blobs[0];
  if (!blob || !isCompareSheetMeta(stored.meta)) return null;
  const crop = stored.meta.crops.find((row) => row.key === spriteKey);
  if (!crop) return null;
  const sheetCanvas = await decodeStoredSheet(sheetKey, stored);
  if (!sheetCanvas || sheetCanvas.width < 1 || sheetCanvas.height < 1) return null;
  const source = stored.meta.source instanceof Blob ? stored.meta.source : blob;
  const union = stored.meta.sheetUnion;
  const bitmap = spriteKey.includes('|glyph-')
    ? cropGlyphFromSheet(sheetCanvas, union, crop, dpr)
    : cropFromWarmSheet(sheetCanvas, union, crop, dpr);
  return { bitmap, blob: source };
}

type CropFromSheet = (
  sheet: HTMLCanvasElement,
  union: CssRect,
  crop: CssRect,
  dpr: number,
) => HTMLCanvasElement;

function commitCompareWarmSheet(
  sheetKey: string,
  sheet: HTMLCanvasElement,
  union: CssRect,
  dpr: number,
  entries: { spriteKey: string; crop: CssRect; dx?: number; dy?: number }[],
  cropFromSheet: CropFromSheet,
): void {
  const captured = rasterSvgBlob(sheet);
  const source = captured;
  if (!source) throw new Error('Compare warm sheet has no SVG source');
  const crops: SheetCropRecord[] = [];
  for (const { spriteKey, crop, dx, dy } of entries) {
    const bitmap = cropFromSheet(sheet, union, crop, dpr);
    sprites.set(spriteKey, Promise.resolve({ bitmap, blob: source }));
    crops.push({ key: spriteKey, ...crop, ...(dx !== undefined ? { dx } : {}), ...(dy !== undefined ? { dy } : {}) });
    if (dx !== undefined && dy !== undefined) numberPatchMeta.set(spriteKey, { dx, dy });
  }
  persistQueue.push({ sheetKey, sheet, captured, sheetUnion: union, crops });
}

async function loadNumberPatch(spriteKey: string, dpr: number): Promise<NumberPatch | null> {
  const meta = numberPatchMeta.get(spriteKey);
  const pending = sprites.get(spriteKey);
  if (meta && pending) {
    try {
      return { sprite: await pending, dx: meta.dx, dy: meta.dy };
    } catch {
      return null;
    }
  }
  const sheetKey = sheetKeyForSprite(spriteKey);
  if (!sheetKey) return null;
  const stored = await loadSprites(sheetKey);
  if (!stored?.blobs[0] || !isCompareSheetMeta(stored.meta)) return null;
  const crop = stored.meta.crops.find((row) => row.key === spriteKey);
  if (!crop || crop.dx === undefined || crop.dy === undefined) return null;
  const sprite = await loadSpriteFromSheet(spriteKey, dpr);
  if (!sprite) return null;
  numberPatchMeta.set(spriteKey, { dx: crop.dx, dy: crop.dy });
  return { sprite, dx: crop.dx, dy: crop.dy };
}

async function loadCachedIfPresent(key: string): Promise<Sprite | null> {
  const pending = sprites.get(key);
  if (pending) {
    try {
      return await pending;
    } catch {
      return null;
    }
  }
  const fromSheet = await loadSpriteFromSheet(key, activeDpr());
  if (fromSheet) return fromSheet;
  const stored = await loadSprites(key);
  const blob = stored?.blobs[0];
  if (!blob) return null;
  const meta = stored.meta;
  const source = meta && typeof meta === 'object' && 'source' in meta && meta.source instanceof Blob
    ? meta.source : blob;
  const bitmap = await decodeStoredBlobToCanvas(blob);
  if (!bitmap || bitmap.width < 1 || bitmap.height < 1) return null;
  return { bitmap, blob: source };
}

async function cachedHasAll(keys: readonly string[]): Promise<boolean> {
  for (const key of keys) {
    if (!(await loadCachedIfPresent(key))) return false;
  }
  return true;
}

async function cached(key: string, capture: () => Promise<HTMLCanvasElement>): Promise<Sprite> {
  let pending = sprites.get(key);
  if (!pending) {
    pending = (async () => {
      const fromSheet = await loadSpriteFromSheet(key, activeDpr());
      if (fromSheet) return fromSheet;
      const stored = await loadSprites(key);
      const blob = stored?.blobs[0];
      if (blob) {
        const meta = stored.meta;
        const source = meta && typeof meta === 'object' && 'source' in meta && meta.source instanceof Blob
          ? meta.source : blob;
        const bitmap = await decodeStoredBlobToCanvas(blob);
        // An empty stored sprite (written by an earlier build) is never served;
        // fall through and recapture, overwriting the bad record.
        if (bitmap && bitmap.width > 0 && bitmap.height > 0) return { bitmap, blob: source };
      }
      const bitmap = await capture();
      if (bitmap.width < 1 || bitmap.height < 1) throw new Error('Compare sprite capture is empty');
      const captured = rasterSvgBlob(bitmap);
      if (captured) {
        persistQueue.push({ key, bitmap, captured });
        return { bitmap, blob: captured };
      }
      const png = await new Promise<Blob | null>((resolve) => bitmap.toBlob(resolve, 'image/png'));
      if (!png) throw new Error('Compare sprite has no blob');
      persistQueue.push({ key, bitmap, captured: null });
      return { bitmap, blob: png };
    })();
    sprites.set(key, pending);
    void pending.catch(() => sprites.delete(key));
  }
  return pending;
}

function trimSprite(sprite: Sprite): { sprite: Sprite; x: number; y: number } {
  const { width, height } = sprite.bitmap;
  const pixels = sprite.bitmap.getContext('2d')!.getImageData(0, 0, width, height).data;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!pixels[(y * width + x) * 4 + 3]) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left) return { sprite, x: 0, y: 0 };
  const w = right - left + 1;
  const h = bottom - top + 1;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(sprite.bitmap, left, top, w, h, 0, 0, w, h);
  return { sprite: { bitmap: canvas, blob: sprite.blob }, x: left, y: top };
}

async function inkPatch(key: string, sprite: Sprite, gold = false, shiftX = 0): Promise<{ sprite: Sprite; x: number; y: number }> {
  const { width, height } = sprite.bitmap;
  const pixels = sprite.bitmap.getContext('2d')!.getImageData(0, 0, width, height).data;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!pixels[(y * width + x) * 4 + 3]) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left) return { sprite, x: 0, y: 0 };
  const bounds = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  const patch = await cached(`${key}|ink-patch`, () => composeCompareInkPatch(sprite.blob, bounds, TRANSPARENT, gold, shiftX));
  return { sprite: patch, x: left, y: top };
}

function removeOverlay(root: HTMLElement): void {
  root.querySelector(`:scope > .${OVERLAY_CLASS}`)?.remove();
}

function hideHeader(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.ticketCard__id,.ticketCard__win').forEach(el => { el.style.visibility = 'hidden'; });
}

function sourceTicket(disabled: boolean, number = 1, badge = 0): Ticket {
  return { id: 'compare-cache-source', no: '0', balls: Array(6).fill(number) as number[], hits: badge ? [0] : [], multipliers: badge > 1 ? { 0: badge } : {}, win: '', disabled };
}

const BADGE_WARM_VALUES = [1, 2, 3, 5, 10] as const;
const BADGE_WARM_CELLS = [1, 2, 3, 4, 5] as const;
/** One opaque patch per face (normal/gold/disabled) × 60 balls — not 2× disabled fills. */
const COMPARE_NUMBER_PATCH_COUNT = 60 * 3;
const COMPARE_BADGE_SPRITE_COUNT = 3 * (1 + MULTIPLIER_VALUES.length);

function compareWarmSheetKeys(packPrefix: string): string[] {
  const keys: string[] = [];
  for (const disabled of ['false', 'true']) {
    for (let batch = 0; batch < 10; batch++) {
      keys.push(compareSheetKey(packPrefix, 'number-ink', disabled, batch));
    }
  }
  for (const face of ['normal', 'gold', 'disabled']) {
    for (let batch = 0; batch < 10; batch++) {
      keys.push(compareSheetKey(packPrefix, 'number-opaque', face, batch));
    }
  }
  for (const face of ['normal', 'gold', 'disabled']) {
    keys.push(compareSheetKey(packPrefix, 'badge-body', face, 0));
  }
  return keys;
}

async function hydratePackFromStoredSheets(
  packPrefix: string,
  dpr: number,
): Promise<{ numberPatches: Map<string, NumberPatch>; badges: Map<string, Sprite> } | null> {
  const sheetKeys = compareWarmSheetKeys(packPrefix);
  const rows = await loadSpritesMany(sheetKeys);
  if (rows.length !== sheetKeys.length) return null;

  const numberPatches = new Map<string, NumberPatch>();
  const badges = new Map<string, Sprite>();

  for (const stored of rows) {
    if (!stored?.blobs[0] || !isCompareSheetMeta(stored.meta)) return null;
  }

  for (let i = 0; i < sheetKeys.length; i++) {
    const stored = rows[i]!;
    const sheetKey = sheetKeys[i]!;
    const meta = stored.meta as CompareSheetMeta;

    const sheetCanvas = await decodeStoredSheet(sheetKey, stored);
    if (!sheetCanvas || sheetCanvas.width < 1 || sheetCanvas.height < 1) return null;

    const source = meta.source instanceof Blob ? meta.source : stored.blobs[0]!;
    const union = meta.sheetUnion;

    for (const crop of meta.crops) {
      const bitmap = crop.key.includes('|glyph-')
        ? cropGlyphFromSheet(sheetCanvas, union, crop, dpr)
        : cropFromWarmSheet(sheetCanvas, union, crop, dpr);
      const sprite: Sprite = { bitmap, blob: source };
      sprites.set(crop.key, Promise.resolve(sprite));

      const badgeIdx = crop.key.indexOf('|badge-body|');
      if (badgeIdx >= 0) {
        badges.set(crop.key.slice(badgeIdx + '|badge-body|'.length), sprite);
        continue;
      }

      const patchMatch = crop.key.match(/\|number-patch\|([^|]+)\|([^|]+)\|(\d+)$/);
      if (patchMatch && crop.dx !== undefined && crop.dy !== undefined) {
        const [, disabledStr, face, nStr] = patchMatch;
        numberPatchMeta.set(crop.key, { dx: crop.dx, dy: crop.dy });
        numberPatches.set(`${disabledStr}|${face}|${nStr}`, {
          sprite,
          dx: crop.dx,
          dy: crop.dy,
        });
      } else if (crop.key.includes('|number-ink|') && crop.dx !== undefined && crop.dy !== undefined) {
        numberPatchMeta.set(crop.key, { dx: crop.dx, dy: crop.dy });
      }
    }
  }

  if (numberPatches.size !== COMPARE_NUMBER_PATCH_COUNT) return null;
  if (badges.size !== COMPARE_BADGE_SPRITE_COUNT) return null;
  return { numberPatches, badges };
}

function forceBadgeFace(card: TicketCard, face: 'normal' | 'gold' | 'disabled'): void {
  card.applyForcedFace(face);
}

function badgeBodyCrop(
  model: ReturnType<typeof resolveCellBoxModel>,
  cellIndex: number,
  headerHeight: number,
  bodyHeight: number,
) {
  return {
    x: model.cells[cellIndex]!.x - 16,
    y: headerHeight,
    width: model.cellW + 32,
    height: bodyHeight,
  };
}

function numberCellCrop(
  model: ReturnType<typeof resolveCellBoxModel>,
  cellIndex: number,
  headerHeight: number,
  bodyHeight: number,
) {
  return { x: model.cells[cellIndex]!.x, y: headerHeight, width: model.cellW, height: bodyHeight };
}

type DeviceRect = { x: number; y: number; width: number; height: number };

function measureInkBounds(bitmap: HTMLCanvasElement): DeviceRect | null {
  const { width, height } = bitmap;
  const pixels = bitmap.getContext('2d')!.getImageData(0, 0, width, height).data;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pixels[(y * width + x) * 4 + 3]) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function inkCropInCell(cellCrop: CssRect, ink: DeviceRect, dpr: number): CssRect {
  return {
    x: cellCrop.x + ink.x / dpr,
    y: cellCrop.y + ink.y / dpr,
    width: ink.width / dpr,
    height: ink.height / dpr,
  };
}

function prepareNumberTransparent(root: HTMLElement, headerHeight: number): void {
  hideHeader(root);
  if (usesSvgText()) {
    stripCompareOverlayHeader(root, headerHeight);
  } else {
    removeOverlay(root);
  }
  root.querySelectorAll<HTMLElement>('.ticketCard__cell').forEach((cell) => {
    cell.style.visibility = 'visible';
  });
  root.querySelectorAll<HTMLElement>('.ticketCard__badgeHost').forEach((host) => {
    host.style.visibility = 'hidden';
  });
}

function prepareNumberOpaque(root: HTMLElement, headerHeight: number): void {
  prepareNumberTransparent(root, headerHeight);
}

function unionCrops(crops: { x: number; y: number; width: number; height: number }[]) {
  const x = Math.min(...crops.map((c) => c.x));
  const y = Math.min(...crops.map((c) => c.y));
  const right = Math.max(...crops.map((c) => c.x + c.width));
  const bottom = Math.max(...crops.map((c) => c.y + c.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** WebKit misbehaves with concurrent foreignObject raster captures (Safari desktop + iOS). */
function compareParallelWarmWidth(): number {
  const ua = navigator.userAgent;
  const webkit = /AppleWebKit/.test(ua);
  const chromium = /Chrom(e|ium)/.test(ua) || /Edg\//.test(ua) || /OPR\//.test(ua);
  return webkit && !chromium ? 1 : 3;
}

/** Isolated offscreen cards — safe to run up to `width` raster captures at once. */
async function parallelCaptures<T>(jobs: (() => Promise<T>)[], width = 3): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < jobs.length; i += width) {
    const chunk = jobs.slice(i, i + width);
    out.push(...await Promise.all(chunk.map((job) => job())));
  }
  return out;
}

function cropFromWarmSheet(
  sheet: HTMLCanvasElement,
  union: { x: number; y: number; width: number; height: number },
  crop: { x: number; y: number; width: number; height: number },
  dpr: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(crop.width * dpr);
  canvas.height = Math.round(crop.height * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const sx = Math.round((crop.x - union.x) * dpr);
  const sy = Math.round((crop.y - union.y) * dpr);
  ctx.drawImage(sheet, sx, sy, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function prepareCompareCard(card: TicketCard, layout: CatalogLayout, dpr: number): void {
  applyTicketCssVars(card.dom, layout.metrics, dpr);
  const model = resolveCellBoxModel(layout, dpr);
  const cells = [...card.dom.querySelectorAll<HTMLElement>('.ticketCard__cell')];
  applyTicketCellLayout(card.dom, cells, model, layout.metrics, layout.cardHeight);
  card.dom.classList.add('ticketCard_compare');
  cells.forEach((cell, i) => {
    const badge = cell.querySelector<HTMLElement>('.ticketCard__badgeHost');
    if (!badge) return;
    const box = badgeHostDevice(model.cells[i]!, layout.metrics.dabSize, dpr);
    Object.assign(badge.style, {
      left: `${box.leftCss}px`, top: `${box.topCss}px`,
      width: `${box.sizeCss}px`, height: `${box.sizeCss}px`,
      backgroundSize: 'contain', backgroundPosition: '0 0',
    });
  });
  // svg-all draws the label inside the card overlay instead.
  applySvgMultiplier(card.dom, usesSvgMultiplier() && !usesSvgText());
  applySvgText(card.dom, usesSvgText(), dpr);
}

async function warmPackImpl(layout: CatalogLayout, dpr: number, key: string): Promise<Pack> {
    await ensureTicketFontsForLayout(layout.metrics);
    const preset = layout.metrics.id;
    const warmT0 = performance.now();
    const hydrated = await hydratePackFromStoredSheets(key, dpr);
    if (hydrated) {
      console.info('[atlas-warm]', {
        preset,
        prefix: key,
        captures: 0,
        ms: Math.round(performance.now() - warmT0),
        fromIdb: 'sheets',
      });
      return {
        numberPatches: hydrated.numberPatches,
        badges: hydrated.badges,
        catalogChrome: new Map(),
        prefix: key,
      };
    }

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';
    host.setAttribute('aria-hidden', 'true');
    const card = new TicketCard();
    host.append(card.dom);
    document.body.append(host);
    const model = resolveCellBoxModel(layout, dpr);
    const m = layout.metrics;
    const numberPatches = new Map<string, NumberPatch>();
    const inkByNumber = new Map<string, DeviceRect>();
    const badges = new Map<string, Sprite>();
    const capture = (part: CompareRasterPart) => rasterizeCompareTicketSvg(card.dom, dpr, m, part);
    let captures = 0;
    try {
      const warmNumberInkBatch = async (disabled: boolean, batch: number): Promise<number> => {
        const balls = Array.from({ length: 6 }, (_, i) => batch * 6 + i + 1);
        const inkSheetKey = compareSheetKey(key, 'number-ink', String(disabled), batch);
        const inkKeys = balls.map((n) => `${key}|number-ink|${disabled}|${n}`);
        if (await cachedHasAll(inkKeys)) {
          for (let cell = 0; cell < 6; cell++) {
            const n = balls[cell]!;
            const patch = await loadNumberPatch(`${key}|number-ink|${disabled}|${n}`, dpr);
            if (!patch) throw new Error('compare number ink cache miss after hasAll');
            const ink = measureInkBounds(patch.sprite.bitmap);
            if (!ink) throw new Error(`Compare number ink bounds missing from cache: ${disabled} ${n}`);
            inkByNumber.set(`${disabled}|${n}`, ink);
          }
          return 0;
        }
        const batchHost = document.createElement('div');
        batchHost.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';
        const batchCard = new TicketCard();
        batchHost.append(batchCard.dom);
        document.body.append(batchHost);
        const batchCapture = (part: CompareRasterPart) => rasterizeCompareTicketSvg(batchCard.dom, dpr, m, part);
        try {
          const ticket = sourceTicket(disabled, balls[0]!);
          ticket.balls = balls as number[];
          batchCard.bind(ticket, 0, 0, layout);
          if (disabled) batchCard.dom.classList.add('ticketCard_disabled');
          else batchCard.dom.classList.remove('ticketCard_disabled', 'ticketCard_win');
          prepareCompareCard(batchCard, layout, dpr);
          const cellCrops = [0, 1, 2, 3, 4, 5].map((cellIndex) =>
            numberCellCrop(model, cellIndex, m.headerHeight, m.bodyHeight),
          );
          const union = unionCrops(cellCrops);
          const sheet = await batchCapture({
            crop: union,
            css: TRANSPARENT,
            prepare(root) {
              prepareNumberTransparent(root, m.headerHeight);
            },
          });
          const entries = balls.map((n, cell) => {
            const cellCrop = cellCrops[cell]!;
            const cellBitmap = cropFromWarmSheet(sheet, union, cellCrop, dpr);
            const ink = measureInkBounds(cellBitmap);
            if (!ink) throw new Error(`Compare number ink bounds missing: ${disabled} ${n}`);
            inkByNumber.set(`${disabled}|${n}`, ink);
            return {
              spriteKey: `${key}|number-ink|${disabled}|${n}`,
              crop: inkCropInCell(cellCrop, ink, dpr),
              dx: ink.x,
              dy: ink.y,
            };
          });
          commitCompareWarmSheet(inkSheetKey, sheet, union, dpr, entries, cropFromWarmSheet);
          return 1;
        } finally {
          batchHost.remove();
        }
      };

      const warmNumberOpaqueBatch = async (
        face: 'normal' | 'gold' | 'disabled',
        batch: number,
      ): Promise<number> => {
        const disabled = numberWarmDisabled(face);
        const balls = Array.from({ length: 6 }, (_, i) => batch * 6 + i + 1);
        const patchKeys = balls.map((n) => numberPatchSpriteKey(key, disabled, face, n));
        if (await cachedHasAll(patchKeys)) {
          for (let i = 0; i < balls.length; i++) {
            const n = balls[i]!;
            const patch = await loadNumberPatch(patchKeys[i]!, dpr);
            if (!patch) throw new Error('compare number patch cache miss after hasAll');
            numberPatches.set(`${disabled}|${face}|${n}`, patch);
          }
          return 0;
        }
        const batchHost = document.createElement('div');
        batchHost.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';
        const batchCard = new TicketCard();
        batchHost.append(batchCard.dom);
        document.body.append(batchHost);
        const batchCapture = (part: CompareRasterPart) => rasterizeCompareTicketSvg(batchCard.dom, dpr, m, part);
        try {
          const ticket = sourceTicket(disabled, balls[0]!);
          ticket.balls = balls as number[];
          batchCard.bind(ticket, 0, 0, layout);
          forceBadgeFace(batchCard, face);
          prepareCompareCard(batchCard, layout, dpr);
          const cellCrops = [0, 1, 2, 3, 4, 5].map((cellIndex) =>
            numberCellCrop(model, cellIndex, m.headerHeight, m.bodyHeight),
          );
          const union = unionCrops(cellCrops);
          const sheet = await batchCapture({
            crop: union,
            css: '.ticketCard__body{border-radius:0!important}',
            prepare(root) {
              prepareNumberOpaque(root, m.headerHeight);
            },
          });
          const sheetKey = compareSheetKey(key, 'number-opaque', face, batch);
          const entries = balls.map((n, cell) => {
            const ink = inkByNumber.get(`${disabled}|${n}`);
            if (!ink) throw new Error(`Compare number ink warm missing: ${disabled} ${n}`);
            const cellCrop = cellCrops[cell]!;
            return {
              spriteKey: numberPatchSpriteKey(key, disabled, face, n),
              crop: inkCropInCell(cellCrop, ink, dpr),
              dx: ink.x,
              dy: ink.y,
            };
          });
          commitCompareWarmSheet(sheetKey, sheet, union, dpr, entries, cropFromWarmSheet);
          for (const { spriteKey, dx, dy } of entries) {
            const sprite = await sprites.get(spriteKey)!;
            const n = Number(spriteKey.split('|').pop());
            numberPatches.set(`${disabled}|${face}|${n}`, { sprite, dx: dx!, dy: dy! });
          }
          return 1;
        } finally {
          batchHost.remove();
        }
      };

      const warmBadgeFace = async (face: 'normal' | 'gold' | 'disabled'): Promise<number> => {
        const badgeValues = [1, ...MULTIPLIER_VALUES];
        const badgeCacheKeys = badgeValues.map((value) => {
          const badgeKey = `${face}|${value}`;
          return `${key}|badge-body|${badgeKey}`;
        });
        if (await cachedHasAll(badgeCacheKeys)) {
          for (let i = 0; i < badgeValues.length; i++) {
            const value = badgeValues[i]!;
            const badgeKey = `${face}|${value}`;
            const sprite = await loadCachedIfPresent(badgeCacheKeys[i]!);
            if (!sprite) throw new Error('compare badge cache miss after hasAll');
            badges.set(badgeKey, sprite);
          }
          return 0;
        }
        const batchHost = document.createElement('div');
        batchHost.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';
        const batchCard = new TicketCard();
        batchHost.append(batchCard.dom);
        document.body.append(batchHost);
        const batchCapture = (part: CompareRasterPart) => rasterizeCompareTicketSvg(batchCard.dom, dpr, m, part);
        try {
          const ticket = sourceTicket(face === 'disabled');
          ticket.hits = [...BADGE_WARM_CELLS];
          ticket.multipliers = Object.fromEntries(
            BADGE_WARM_CELLS.map((cell, i) => [cell, BADGE_WARM_VALUES[i]!]).filter(([, v]) => v > 1),
          );
          ticket.disabled = face === 'disabled';
          ticket.win = '';
          batchCard.bind(ticket, 0, 0, layout);
          forceBadgeFace(batchCard, face);
          for (let i = 0; i < 6; i++) batchCard.clearCellDigit(i);
          prepareCompareCard(batchCard, layout, dpr);
          const cellCrops = BADGE_WARM_CELLS.map((cellIndex) =>
            badgeBodyCrop(model, cellIndex, m.headerHeight, m.bodyHeight),
          );
          const union = unionCrops(cellCrops);
          const sheet = await batchCapture({
            crop: union,
            css: '.ticketCard__body{border-radius:0!important}',
            prepare(root) {
              hideHeader(root);
              if (!usesSvgText()) {
                removeOverlay(root);
                root.querySelectorAll<HTMLElement>('.ticketCard__cell').forEach((cell, i) => {
                  for (const node of [...cell.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.textContent = '';
                  if (i === 0 || !BADGE_WARM_CELLS.includes(i as 1 | 2 | 3 | 4 | 5)) {
                    root.querySelectorAll<HTMLElement>('.ticketCard__badgeHost').forEach((badge) => {
                      badge.style.visibility = 'hidden';
                    });
                  }
                });
              } else {
                stripCompareOverlayHeaderAndCellNumbers(root);
                root.querySelectorAll<HTMLElement>('.ticketCard__cell').forEach((cell, i) => {
                  cell.style.visibility = i > 0 && i <= 5 ? 'visible' : 'hidden';
                });
              }
            },
          });
          const sheetEntries = badgeValues.map((value) => {
            const warmIdx = BADGE_WARM_VALUES.indexOf(value as (typeof BADGE_WARM_VALUES)[number]);
            const badgeKey = `${face}|${value}`;
            return {
              spriteKey: `${key}|badge-body|${badgeKey}`,
              crop: cellCrops[warmIdx]!,
              badgeKey,
            };
          });
          const sheetKey = compareSheetKey(key, 'badge-body', face, 0);
          commitCompareWarmSheet(
            sheetKey,
            sheet,
            union,
            dpr,
            sheetEntries.map(({ spriteKey, crop }) => ({ spriteKey, crop })),
            cropFromWarmSheet,
          );
          for (const { badgeKey, spriteKey } of sheetEntries) {
            badges.set(badgeKey, await sprites.get(spriteKey)!);
          }
          return 1;
        } finally {
          batchHost.remove();
        }
      };

      for (const disabled of [false, true]) {
        const inkCounts = await parallelCaptures(
          Array.from({ length: 10 }, (_, batch) => () => warmNumberInkBatch(disabled, batch)),
          compareParallelWarmWidth(),
        );
        captures += inkCounts.reduce((sum, n) => sum + n, 0);
      }
      for (const face of ['normal', 'gold', 'disabled'] as const) {
        const opaqueCounts = await parallelCaptures(
          Array.from({ length: 10 }, (_, batch) => () => warmNumberOpaqueBatch(face, batch)),
          compareParallelWarmWidth(),
        );
        captures += opaqueCounts.reduce((sum, n) => sum + n, 0);
      }
      // Precompose image antialiasing on the real body background. Re-compositing
      // an already rounded transparent image can change its edge colors.
      const badgeCounts = await parallelCaptures(
        (['normal', 'gold', 'disabled'] as const).map((face) => () => warmBadgeFace(face)),
        compareParallelWarmWidth(),
      );
      captures += badgeCounts.reduce((sum, n) => sum + n, 0);
      if (compareD1ProbeEnabled()) {
        let identicalAcrossCells = true;
        for (const disabled of [false, true]) {
          for (let n = 1; n <= 60; n++) {
            card.bind(sourceTicket(disabled, n), 0, 0, layout);
            if (disabled) card.dom.classList.add('ticketCard_disabled');
            else card.dom.classList.remove('ticketCard_disabled', 'ticketCard_win');
            prepareCompareCard(card, layout, dpr);
            const cell0Sprite = await cached(`${key}|d1-cell0|${disabled}|${n}`, () =>
              capture({
                crop: numberCellCrop(model, 0, m.headerHeight, m.bodyHeight),
                css: TRANSPARENT,
                prepare(root) {
                  hideHeader(root);
                  root.querySelectorAll<HTMLElement>('.ticketCard__cell').forEach((cell, i) => {
                    cell.style.visibility = i === 0 ? 'visible' : 'hidden';
                  });
                },
              }),
            );
            const bytes: Uint8ClampedArray[] = [];
            for (let cell = 0; cell < 6; cell++) {
              const patch = await inkPatch(
                `${key}|d1|${disabled}|${n}|${cell}`,
                cell0Sprite,
                false,
                model.cells[cell]!.x,
              );
              const { width, height } = patch.sprite.bitmap;
              bytes.push(patch.sprite.bitmap.getContext('2d')!.getImageData(0, 0, width, height).data);
            }
            const first = bytes[0]!;
            for (let cell = 1; cell < 6; cell++) {
              const row = bytes[cell]!;
              if (row.length !== first.length) {
                identicalAcrossCells = false;
                break;
              }
              for (let i = 0; i < first.length; i++) {
                if (row[i] !== first[i]) {
                  identicalAcrossCells = false;
                  break;
                }
              }
              if (!identicalAcrossCells) break;
            }
            if (!identicalAcrossCells) break;
          }
          if (!identicalAcrossCells) break;
        }
        console.info('[d1] identical across cells:', identicalAcrossCells);
      }
      console.info('[atlas-warm]', { preset, prefix: key, captures, ms: Math.round(performance.now() - warmT0) });
      scheduleFlushPersistQueue();
      return { numberPatches, badges, catalogChrome: new Map(), prefix: key };
    } finally { host.remove(); }
}

function catalogChromeCacheKey(packPrefix: string, face: string): string {
  const variant = CATALOG_FIGMA_DESKTOP_LOCK ? "svgface-v3" : "html";
  return `${packPrefix}|catalog-chrome|${variant}|${face}`;
}

/** Face chrome for catalog tiles (stable key — no live layout-origin fraction). */
export async function warmCatalogChromeSprites(
  layout: CatalogLayout,
  dpr: number,
  pack: ComparePaintPack,
): Promise<void> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';
  const card = new TicketCard();
  styleCompareTicketDom(card.dom);
  host.append(card.dom);
  document.body.append(host);
  const m = layout.metrics;
  const capture = (part: CompareRasterPart) => rasterizeCompareTicketSvg(card.dom, dpr, m, part);
  try {
    for (const face of ['normal', 'gold', 'disabled'] as const) {
      const cacheKey = catalogChromeCacheKey(pack.prefix, face);
      const sprite = await cached(cacheKey, async () => {
        const ticket = sourceTicket(face === 'disabled');
        if (face === 'gold') {
          ticket.hits = [0, 1];
          ticket.win = '$0';
        }
        card.bind(ticket, 0, 0, layout);
        forceBadgeFace(card, face);
        if (CATALOG_FIGMA_DESKTOP_LOCK) card.dom.classList.add(SVG_FACE_CLASS);
        prepareCompareCard(card, layout, dpr);
        return capture({
          css: CATALOG_FIGMA_DESKTOP_LOCK
            ? '.ticketCard__cell::before{visibility:hidden!important}'
            : '.ticketCard__cell::before{visibility:visible!important}',
          prepare(root) {
            hideHeader(root);
            root.querySelectorAll<HTMLElement>('.ticketCard__cell').forEach((cell) => {
              for (const node of [...cell.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.textContent = '';
            });
            root.querySelectorAll<HTMLElement>('.ticketCard__badgeHost').forEach((el) => {
              el.style.visibility = 'hidden';
            });
            if (CATALOG_FIGMA_DESKTOP_LOCK) {
              root.classList.add(SVG_FACE_CLASS);
              stripOverlayInkKeepChrome(root);
            } else {
              removeOverlay(root);
            }
          },
        });
      });
      pack.catalogChrome.set(face, sprite);
    }
    scheduleFlushPersistQueue();
  } finally {
    host.remove();
  }
}

/** svg-all atlas for catalog canvas: number/badge sheets + chrome + header glyphs. */
export async function warmCatalogCompareAtlas(
  layout: CatalogLayout,
  dpr: number,
): Promise<ComparePaintPack> {
  const pack = await preloadComparePack(layout, dpr);
  if (!pack.catalogChrome) pack.catalogChrome = new Map();
  await warmCatalogChromeSprites(layout, dpr, pack);
  if (!pack.headerGlyphs) {
    pack.headerGlyphs = await warmHeaderGlyphsOffscreen(pack, layout, dpr);
  }
  return pack;
}

function warmPack(layout: CatalogLayout, dpr: number): Promise<Pack> {
  const key = prefix(layout, dpr);
  const existing = packs.get(key);
  if (existing) return existing;
  let resolvePack!: (pack: Pack) => void;
  let rejectPack!: (error: unknown) => void;
  const pending = new Promise<Pack>((resolve, reject) => {
    resolvePack = resolve;
    rejectPack = reject;
  });
  packs.set(key, pending);
  void pending.catch(() => packs.delete(key));
  void (async () => {
    try {
      resolvePack(await warmPackImpl(layout, dpr, key));
    } catch (error) {
      packs.delete(key);
      rejectPack(error);
    }
  })();
  return pending;
}

const headerGlyphWarm = new Map<string, Promise<HeaderGlyphPack>>();

async function warmHeaderGlyphsOffscreen(pack: Pack, layout: CatalogLayout, dpr: number): Promise<HeaderGlyphPack> {
  await ensureTicketFontsForLayout(layout.metrics);
  const warmW = glyphWarmMinCardWidthCss();
  const host = document.createElement('div');
  host.style.cssText =
    `position:fixed;left:-10000px;top:0;width:${warmW}px;height:${layout.cardHeight}px;overflow:visible;visibility:hidden;pointer-events:none`;
  const card = new TicketCard();
  styleCompareTicketDom(card.dom);
  host.append(card.dom);
  document.body.append(host);
  const m = layout.metrics;
  const capture = (part: CompareRasterPart) => rasterizeCompareTicketSvg(card.dom, dpr, m, part);
  const bindFace = (face: 'normal' | 'gold' | 'disabled', idChar: string, winChar: string) => {
    const ticket = sourceTicket(face === 'disabled');
    ticket.no = idChar || '0';
    ticket.win = winChar;
    if (winChar) ticket.hits = [0, 1];
    else if (face === 'gold') ticket.hits = [1, 2];
    else ticket.hits = [];
    card.bind(ticket, 0, 0, layout);
  };
  try {
    const glyphs = await warmHeaderGlyphPack(
      pack.prefix,
      (cacheKey, cap) => cached(cacheKey, cap),
      cachedHasAll,
      (sheetKey, sheet, union, entries) => {
        commitCompareWarmSheet(sheetKey, sheet, union, dpr, entries, cropGlyphFromSheet);
      },
      capture,
      bindFace,
      () => {
        prepareCompareCard(card, layout, dpr);
        widenCardForGlyphWarm(card.dom);
      },
      card.dom,
      dpr,
      m.headerHeight,
      TRANSPARENT,
      layout.metrics.id,
    );
    scheduleFlushPersistQueue();
    return glyphs;
  } finally {
    host.remove();
  }
}

/** svg-all: warm numbers and badges before compare stacks paint. */
export async function preloadComparePack(layout: CatalogLayout, dpr: number): Promise<Pack> {
  return warmPack(layout, dpr);
}

/** Header glyphs after first paint — optimized row awaits this in ensureHeaderGlyphs. */
export function scheduleCompareGlyphWarm(layout: CatalogLayout, dpr: number, pack: Pack): void {
  if (!usesSvgText() || pack.headerGlyphs) return;
  const run = () => {
    void (async () => {
      let pending = headerGlyphWarm.get(pack.prefix);
      if (!pending) {
        pending = warmHeaderGlyphsOffscreen(pack, layout, dpr);
        headerGlyphWarm.set(pack.prefix, pending);
        void pending.catch(() => headerGlyphWarm.delete(pack.prefix));
      }
      pack.headerGlyphs = await pending;
    })();
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run);
  else run();
}

/** svg-all: pack sync, glyphs in idle time. */
export async function preloadCompareAtlasWarm(layout: CatalogLayout, dpr: number): Promise<void> {
  if (!usesSvgText()) return;
  const pack = await preloadComparePack(layout, dpr);
  scheduleCompareGlyphWarm(layout, dpr, pack);
}

async function ensureHeaderGlyphs(
  live: HTMLElement,
  layout: CatalogLayout,
  dpr: number,
  pack: Pack,
): Promise<HeaderGlyphPack> {
  if (pack.headerGlyphs) return pack.headerGlyphs;
  let pending = headerGlyphWarm.get(pack.prefix);
  if (!pending) {
    pending = (async () => {
      const rect = live.getBoundingClientRect();
      const warmW = Math.max(rect.width, glyphWarmMinCardWidthCss());
      const host = document.createElement('div');
      host.style.cssText =
        `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${warmW}px;height:${rect.height}px;overflow:visible;visibility:hidden;pointer-events:none`;
      const card = new TicketCard();
      styleCompareTicketDom(card.dom);
      host.append(card.dom);
      document.body.append(host);
      alignCompareStackOrigin(host);
      const m = layout.metrics;
      const capture = (part: CompareRasterPart) => rasterizeCompareTicketSvg(card.dom, dpr, m, part);
      const bindFace = (face: 'normal' | 'gold' | 'disabled', idChar: string, winChar: string) => {
        const ticket = sourceTicket(face === 'disabled');
        ticket.no = idChar || '0';
        ticket.win = winChar;
        if (winChar) ticket.hits = [0, 1];
        else if (face === 'gold') ticket.hits = [1, 2];
        else ticket.hits = [];
        card.bind(ticket, 0, 0, layout);
      };
      try {
        const glyphs = await warmHeaderGlyphPack(
          pack.prefix,
          (cacheKey, cap) => cached(cacheKey, cap),
          cachedHasAll,
          (sheetKey, sheet, union, entries) => {
            commitCompareWarmSheet(sheetKey, sheet, union, dpr, entries, cropGlyphFromSheet);
          },
          capture,
          bindFace,
          () => {
            prepareCompareCard(card, layout, dpr);
            widenCardForGlyphWarm(card.dom);
          },
          card.dom,
          dpr,
          m.headerHeight,
          TRANSPARENT,
          layout.metrics.id,
        );
        scheduleFlushPersistQueue();
        return glyphs;
      } finally {
        host.remove();
      }
    })();
    headerGlyphWarm.set(pack.prefix, pending);
    void pending.catch(() => headerGlyphWarm.delete(pack.prefix));
  }
  pack.headerGlyphs = await pending;
  return pack.headerGlyphs;
}

export async function assembleCompareSprites(live: HTMLElement, ticket: Ticket, layout: CatalogLayout, dpr: number): Promise<HTMLCanvasElement> {
  const pack = await preloadComparePack(layout, dpr);
  const m = layout.metrics;
  const capture = (part: CompareRasterPart) => rasterizeCompareTicketSvg(live, dpr, m, part);
  const model = resolveCellBoxModel(layout, dpr);
  const face = ticket.disabled ? 'disabled' : isWinTicket(ticket) ? 'gold' : 'normal';
  // Live-card captures depend on the card's layout-origin fraction (WebKit text
  // rounding). Key them by it so a capture taken mid-reflow can never be reused
  // at a settled whole-pixel origin.
  const liveRect = live.getBoundingClientRect();
  const frac = (v: number) => (v - Math.round(v)).toFixed(4);
  const origin = `o${frac(liveRect.left + window.scrollX)},${frac(liveRect.top + window.scrollY)}`;
  const liveKey = `${pack.prefix}|${origin}`;
  const chrome = await cached(`${liveKey}|chrome|${face}`, () => capture({
    css: '.ticketCard__cell::before{visibility:visible!important}',
    prepare(root) {
      hideHeader(root);
      removeOverlay(root);
      root.querySelectorAll<HTMLElement>('.ticketCard__cell').forEach(cell => { for (const node of [...cell.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.textContent = ''; });
      root.querySelectorAll<HTMLElement>('.ticketCard__badgeHost').forEach(el => { el.style.visibility = 'hidden'; });
    },
  }));
  if (usesSvgText()) {
    return assembleWithOverlay(live, ticket, layout, dpr, pack, chrome.bitmap, model.cells.map(c => c.x), model.cellW, liveKey);
  }
  const headerPart = (selector: string): CompareRasterPart => ({
    crop: { x: 0, y: 0, width: layout.cardWidth, height: m.headerHeight },
    css: TRANSPARENT,
    prepare(root) {
      hideHeader(root);
      root.querySelector<HTMLElement>(selector)!.style.visibility = 'visible';
      root.querySelector<HTMLElement>('.ticketCard__body')!.style.visibility = 'hidden';
    },
  });
  const idElement = live.querySelector<HTMLElement>('.ticketCard__id')!;
  const text = idElement.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('Compare ID text missing');
  const rootRect = live.getBoundingClientRect();
  const ids: { sprite: Sprite; x: number; y: number }[] = [];
  for (let i = 0; i < ticket.no.length; i++) {
    const range = document.createRange();
    range.setStart(text, i);
    range.setEnd(text, i + 1);
    const rect = range.getBoundingClientRect();
    const start = (rect.left - rootRect.left) * dpr;
    const x = Math.floor(start);
    const right = i === ticket.no.length - 1
      ? Math.ceil((rect.right - rootRect.left) * dpr)
      : Math.floor((rect.right - rootRect.left) * dpr);
    const width = right - x;
    const phase = Math.round((start - x) * 64);
    const part = headerPart('.ticketCard__id');
    part.crop = { x: x / dpr, y: 0, width: width / dpr, height: m.headerHeight };
    const sprite = await cached(`${liveKey}|id-digit|${face}|${ticket.no[i]}|${phase}|${width}`,
      () => capture(part));
    const patch = await inkPatch(`${liveKey}|id-digit|${face}|${ticket.no[i]}|${phase}|${width}`, sprite);
    ids.push({ sprite: patch.sprite, x: x + patch.x, y: patch.y });
  }
  const amount = isWinTicket(ticket) && ticket.win
    ? await cached(`${liveKey}|amount|${face}|${ticket.win}`, () => capture(headerPart('.ticketCard__win')))
    : null;
  const amountPatch = amount ? await inkPatch(`${liveKey}|amount|${face}|${ticket.win}`, amount) : null;
  const numberPatches = await Promise.all(ticket.balls.map((ball, i) => {
    if (ticket.hits.includes(i) || ticket.multipliers[i]) return Promise.resolve(null);
    const patch = pack.numberPatches.get(`${Boolean(ticket.disabled)}|${face}|${ball}`);
    return patch ? Promise.resolve(patch) : Promise.reject(new Error(`Compare number patch missing: ${face} ${ball}`));
  }));
  const out = document.createElement('canvas');
  out.width = Math.round(layout.cardWidth * dpr);
  out.height = Math.round(layout.cardHeight * dpr);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Compare 2D context unavailable');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(chrome.bitmap, 0, 0);
  for (const id of ids) ctx.drawImage(id.sprite.bitmap, id.x, id.y);
  if (amountPatch) ctx.drawImage(amountPatch.sprite.bitmap, amountPatch.x, amountPatch.y);
  for (let i = 0; i < 6; i++) {
    const x = Math.round(model.cells[i]!.x * dpr);
    const y = Math.round(m.headerHeight * dpr);
    const mult = ticket.multipliers[i] ?? 0;
    if (ticket.hits.includes(i) || mult) {
      const badge = pack.badges.get(`${face}|${mult || 1}`)!;
      const pad = Math.round(16 * dpr);
      const width = Math.round(model.cellW * dpr);
      ctx.drawImage(badge.bitmap, pad, 0, width, badge.bitmap.height,
        x, y, width, badge.bitmap.height);
    }
  }
  for (let i = 0; i < 6; i++) {
    if (ticket.hits.includes(i) || ticket.multipliers[i]) continue;
    const patch = numberPatches[i]!;
    ctx.drawImage(
      patch.sprite.bitmap,
      Math.round(model.cells[i]!.x * dpr) + patch.dx,
      Math.round(m.headerHeight * dpr) + patch.dy,
    );
  }
  return out;
}

/** svg-all: chrome + plain dab sprites, then the ticket overlay (header, numbers, multipliers). */
async function assembleWithOverlay(
  live: HTMLElement,
  ticket: Ticket,
  layout: CatalogLayout,
  dpr: number,
  pack: Pack,
  chrome: HTMLCanvasElement,
  cellX: number[],
  cellW: number,
  liveKey: string,
): Promise<HTMLCanvasElement> {
  const face = ticket.disabled ? 'disabled' : isWinTicket(ticket) ? 'gold' : 'normal';
  const out = document.createElement('canvas');
  out.width = Math.round(layout.cardWidth * dpr);
  out.height = Math.round(layout.cardHeight * dpr);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Compare 2D context unavailable');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(chrome, 0, 0);
  paintSvgAllCompareTicket(ctx, ticket, pack, layout, cellX, cellW, face, 0, 0, dpr);
  const glyphs = await ensureHeaderGlyphs(live, layout, dpr, pack);
  const winText = isWinTicket(ticket) && ticket.win ? ticket.win : '';
  await stampHeaderGlyphs(ctx, live, ticket.no, winText, face, dpr, glyphs, async (_k, s) => trimSprite(s), liveKey);
  return out;
}
