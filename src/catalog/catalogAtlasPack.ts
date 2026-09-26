/**
 * Unified catalog atlas: one IDB record per layout+DPR, phased PNG decode for TTI.
 */

import { loadSprites, loadSpritesMany, saveSprites } from "./atlasStore";
import { activeDpr } from "./cellBoxModel";
import {
  applyDisabledCellBlobs,
  cacheCellBitmaps,
  cacheTicketChrome,
  captureActiveCellSet,
  captureDisabledCellSet,
  captureTicketChromeBitmap,
  cellBitmapCacheKey,
  cellBitmapsFromActiveBlobs,
  CELL_BADGE_PAD_CSS,
  CELL_BLOB_COUNT,
  chromePngBlobFromCanvas,
  exportActiveCellPngBlobs,
  exportDisabledCellPngBlobs,
  getCellBitmaps,
} from "./cellBitmaps";
import { getActiveLayout } from "./catalogLayout";
import {
  catalogDigitPackEntries,
  captureDigitPackPngs,
  exportAmountPngBlobs,
  headerStyleKey,
  hydrateAmountsFromPack,
  idDigitPackIdbKey,
  installDigitsFromPack,
  resetDigitHydration,
  warmAmounts,
  type IdColor,
} from "./headerGlyphs";
import {
  decodePngBlobsToBitmaps,
  decodePngBlobsToCanvases,
} from "./spriteDecodeClient";
import { svgBlobToPngBlob } from "./ticketSvgRaster";

const PACK_PREFIX = "catalog-atlas-v1";
const CHROME_IDB = "chrome-v2-png";

const CELLS_ACTIVE = CELL_BLOB_COUNT;
const CELLS_DISABLED = CELL_BLOB_COUNT;
const DIGIT_COUNT = 30;
const CHROME_COUNT = 3;

export const PACK_FIXED_BLOB_COUNT =
  CELLS_ACTIVE + CELLS_DISABLED + DIGIT_COUNT + CHROME_COUNT;

const OFF_CELLS_ACTIVE = 0;
const OFF_CELLS_DISABLED = CELLS_ACTIVE;
const OFF_DIGITS = OFF_CELLS_DISABLED + CELLS_DISABLED;
const OFF_CHROME_PLAIN = OFF_DIGITS + DIGIT_COUNT;
const OFF_CHROME_WIN = OFF_CHROME_PLAIN + 1;
const OFF_CHROME_DISABLED = OFF_CHROME_WIN + 1;
const OFF_AMOUNTS = OFF_CHROME_DISABLED + 1;

export type CatalogAtlasPackMeta = {
  packVersion: 1;
  padCss: number;
  digitEntries: { color: IdColor; digit: string }[];
  amountEntries: string[];
};

type LoadedPack = {
  key: string;
  meta: CatalogAtlasPackMeta;
  blobs: Blob[];
};

let warmGen = 0;
let phase1Promise: Promise<void> | null = null;
let phase1Key: string | null = null;
let loadedPack: LoadedPack | null = null;

export function catalogAtlasPackKey(): string {
  const layout = getActiveLayout();
  return `${PACK_PREFIX}|${layout.metrics.id}|cw=${layout.cardWidth}|dpr=${activeDpr()}`;
}

export function cancelCatalogAtlasWarm(): void {
  warmGen += 1;
  phase1Promise = null;
  phase1Key = null;
}

function chromeRamKey(win: boolean, disabled: boolean): string {
  const layout = getActiveLayout();
  const face = disabled ? "disabled" : win ? "win" : "plain";
  return `${layout.metrics.id}|${layout.cardWidth}|${activeDpr()}|${face}`;
}

function chromeIdbKey(win: boolean, disabled: boolean): string {
  return `${CHROME_IDB}|${chromeRamKey(win, disabled)}`;
}

function disabledCellIdbKey(): string {
  return `${cellBitmapCacheKey()}|disabled`;
}

function isPngPack(blobs: readonly Blob[]): boolean {
  const t = blobs[0]?.type ?? "";
  return t.includes("png");
}

async function blobsToPng(blobs: Blob[]): Promise<Blob[] | null> {
  if (blobs.length === 0) return [];
  if (isPngPack(blobs)) return blobs;
  try {
    return await Promise.all(blobs.map((b) => svgBlobToPngBlob(b)));
  } catch {
    return null;
  }
}

async function singleBlobToPng(blob: Blob): Promise<Blob | null> {
  if (blob.type.includes("png")) return blob;
  try {
    return await svgBlobToPngBlob(blob);
  } catch {
    return null;
  }
}

function expectedDigitEntries(): { color: IdColor; digit: string }[] {
  return catalogDigitPackEntries();
}

function validatePack(row: LoadedPack): boolean {
  if (row.meta.packVersion !== 1) return false;
  if (row.blobs.length < PACK_FIXED_BLOB_COUNT) return false;
  if (row.meta.digitEntries.length !== DIGIT_COUNT) return false;
  const amountN = row.meta.amountEntries.length;
  if (row.blobs.length !== PACK_FIXED_BLOB_COUNT + amountN) return false;
  return true;
}

async function migrateLegacyPack(key: string): Promise<LoadedPack | null> {
  const dKey = disabledCellIdbKey();
  const digitKey = idDigitPackIdbKey();
  const digitLegacy = `ticket-id-digits-v1|${headerStyleKey()}`;
  const chromeKeys = [
    chromeIdbKey(false, false),
    chromeIdbKey(true, false),
    chromeIdbKey(false, true),
  ];
  const chromeLegacyKeys = [
    `chrome-v1|${chromeRamKey(false, false)}`,
    `chrome-v1|${chromeRamKey(true, false)}`,
    `chrome-v1|${chromeRamKey(false, true)}`,
  ];
  const rows = await loadSpritesMany([
    cellBitmapCacheKey(),
    dKey,
    digitKey,
    digitLegacy,
    ...chromeKeys,
    ...chromeLegacyKeys,
  ]);
  const activeStored = rows[0];
  const disabledStored = rows[1];
  let digitStored = rows[2];
  if (!digitStored?.blobs?.length) digitStored = rows[3] ?? null;

  let activeBlobs: Blob[] | null = null;
  if (activeStored?.blobs.length === CELL_BLOB_COUNT) {
    activeBlobs = await blobsToPng(activeStored.blobs);
  }
  if (!activeBlobs) return null;

  let disabledBlobs: Blob[] | null = null;
  if (disabledStored?.blobs.length === CELL_BLOB_COUNT) {
    disabledBlobs = await blobsToPng(disabledStored.blobs);
  }
  if (!disabledBlobs) return null;

  let digitEntries = expectedDigitEntries();
  let digitBlobs: Blob[] | null = null;
  if (digitStored?.meta && digitStored.blobs.length === DIGIT_COUNT) {
    const meta = digitStored.meta as { entries?: { color: IdColor; digit: string }[] };
    if (meta.entries?.length === DIGIT_COUNT) digitEntries = meta.entries;
    digitBlobs = await blobsToPng(digitStored.blobs);
  }
  if (!digitBlobs) return null;

  const chromeBlobs: Blob[] = [];
  for (let i = 0; i < 3; i++) {
    let stored = rows[4 + i];
    if (!stored?.blobs[0]) stored = rows[7 + i] ?? null;
    if (!stored?.blobs[0]) return null;
    const png = await singleBlobToPng(stored.blobs[0]);
    if (!png) return null;
    chromeBlobs.push(png);
  }

  const meta: CatalogAtlasPackMeta = {
    packVersion: 1,
    padCss: CELL_BADGE_PAD_CSS,
    digitEntries,
    amountEntries: [],
  };
  const blobs = [
    ...activeBlobs,
    ...disabledBlobs,
    ...digitBlobs,
    ...chromeBlobs,
  ];
  const pack: LoadedPack = { key, meta, blobs };
  void saveSprites({ key, meta, blobs });
  return pack;
}

async function captureFullPack(host: HTMLElement, key: string): Promise<LoadedPack> {
  const activeSet = await captureActiveCellSet(host);
  const disabledPart = await captureDisabledCellSet(host);
  activeSet.disabledNumbers = disabledPart.disabledNumbers;
  activeSet.disabledDab = disabledPart.disabledDab;
  activeSet.disabledMultipliers = disabledPart.disabledMultipliers;

  const activeBlobs = await exportActiveCellPngBlobs(activeSet);
  const disabledBlobs = await exportDisabledCellPngBlobs(activeSet);
  if (!activeBlobs || !disabledBlobs) {
    const activeN = activeSet.numbers.filter(Boolean).length;
    const disabledN = activeSet.disabledNumbers.filter(Boolean).length;
    throw new Error(
      `cell pack encode failed (active=${activeBlobs ? activeBlobs.length : "fail"} sprites=${activeN}, disabled=${disabledBlobs ? disabledBlobs.length : "fail"} sprites=${disabledN})`,
    );
  }

  const { entries: digitEntries, blobs: digitBlobs } = await captureDigitPackPngs(host);

  const chromePlainCanvas = await captureTicketChromeBitmap(host, false, false);
  const chromeWinCanvas = await captureTicketChromeBitmap(host, true, false);
  const chromeDisabledCanvas = await captureTicketChromeBitmap(host, false, true);
  const chromePlain = await chromePngBlobFromCanvas(chromePlainCanvas);
  const chromeWin = await chromePngBlobFromCanvas(chromeWinCanvas);
  const chromeDisabled = await chromePngBlobFromCanvas(chromeDisabledCanvas);
  if (!chromePlain || !chromeWin || !chromeDisabled) {
    throw new Error("chrome pack encode failed");
  }

  cacheTicketChrome(false, false, chromePlainCanvas);
  cacheTicketChrome(true, false, chromeWinCanvas);
  cacheTicketChrome(false, true, chromeDisabledCanvas);

  const { entries: amountEntries, blobs: amountBlobs } = await exportAmountPngBlobs();

  const meta: CatalogAtlasPackMeta = {
    packVersion: 1,
    padCss: CELL_BADGE_PAD_CSS,
    digitEntries,
    amountEntries,
  };
  const blobs = [
    ...activeBlobs,
    ...disabledBlobs,
    ...digitBlobs,
    chromePlain,
    chromeWin,
    chromeDisabled,
    ...amountBlobs,
  ];
  const pack: LoadedPack = { key, meta, blobs };
  void saveSprites({ key, meta, blobs });
  cacheCellBitmaps(activeSet);
  loadedPack = pack;
  return pack;
}

async function loadOrCapturePack(host: HTMLElement): Promise<LoadedPack> {
  const key = catalogAtlasPackKey();
  if (loadedPack?.key === key && validatePack(loadedPack)) return loadedPack;

  let stored = await loadSprites(key);
  if (stored?.blobs && stored.meta) {
    const pack: LoadedPack = {
      key,
      meta: stored.meta as CatalogAtlasPackMeta,
      blobs: stored.blobs,
    };
    if (validatePack(pack)) {
      loadedPack = pack;
      return pack;
    }
  }

  const migrated = await migrateLegacyPack(key);
  if (migrated) {
    loadedPack = migrated;
    return migrated;
  }

  return captureFullPack(host, key);
}

function sliceBlobs(pack: LoadedPack, start: number, count: number): Blob[] {
  return pack.blobs.slice(start, start + count);
}

async function applyPhase1(pack: LoadedPack): Promise<void> {
  resetDigitHydration();
  const activeBlobs = sliceBlobs(pack, OFF_CELLS_ACTIVE, CELLS_ACTIVE);
  const digitBlobs = sliceBlobs(pack, OFF_DIGITS, DIGIT_COUNT);
  const chromePlainBlob = pack.blobs[OFF_CHROME_PLAIN]!;

  const [setFromBlobs, digitCanvases, chromeSprites] = await Promise.all([
    cellBitmapsFromActiveBlobs(activeBlobs),
    decodePngBlobsToCanvases(digitBlobs),
    decodePngBlobsToBitmaps([chromePlainBlob]),
  ]);
  if (!setFromBlobs) throw new Error("phase1 active cells decode failed");
  cacheCellBitmaps(setFromBlobs);

  installDigitsFromPack(pack.meta.digitEntries, digitCanvases, digitBlobs);

  const chromePlain = chromeSprites[0];
  if (!chromePlain) throw new Error("phase1 chrome decode failed");
  cacheTicketChrome(false, false, chromePlain);
}

async function applyPhase2(pack: LoadedPack): Promise<void> {
  const cached = getCellBitmaps();
  if (!cached) return;

  const disabledBlobs = sliceBlobs(pack, OFF_CELLS_DISABLED, CELLS_DISABLED);
  await applyDisabledCellBlobs(cached, disabledBlobs);

  const chromeWinBlob = pack.blobs[OFF_CHROME_WIN]!;
  const chromeDisabledBlob = pack.blobs[OFF_CHROME_DISABLED]!;
  const [winSprite, disabledSprite] = await decodePngBlobsToBitmaps([
    chromeWinBlob,
    chromeDisabledBlob,
  ]);
  if (winSprite) cacheTicketChrome(true, false, winSprite);
  if (disabledSprite) cacheTicketChrome(false, true, disabledSprite);
}

async function applyAmountsSection(pack: LoadedPack): Promise<void> {
  const { amountEntries } = pack.meta;
  if (amountEntries.length === 0) return;
  const amountBlobs = pack.blobs.slice(OFF_AMOUNTS);
  await hydrateAmountsFromPack(amountEntries, amountBlobs);
}

/** Phase 1: active cells, all id digits, plain chrome (96 PNG decodes). */
export function warmCatalogAtlasPhase1(host: HTMLElement): Promise<void> {
  const key = catalogAtlasPackKey();
  const gen = warmGen;
  if (phase1Promise && phase1Key === key) return phase1Promise;

  phase1Key = key;
  const run = (async () => {
    const pack = await loadOrCapturePack(host);
    if (gen !== warmGen) return;
    await applyPhase1(pack);
    if (gen !== warmGen) return;
    loadedPack = pack;
  })().finally(() => {
    if (phase1Key === key && gen === warmGen) {
      phase1Promise = null;
    }
  });
  phase1Promise = run;
  return run;
}

/** Phase 2: disabled cells + win/disabled chrome. */
export async function warmCatalogAtlasPhase2(host: HTMLElement): Promise<void> {
  const gen = warmGen;
  const pack = loadedPack ?? await loadOrCapturePack(host);
  if (gen !== warmGen) return;
  if (pack.key !== catalogAtlasPackKey()) return;
  await applyPhase2(pack);
}

/** Phase 3: amount sprites from pack + capture/persist any new strings. */
export async function warmCatalogAtlasAmounts(
  host: HTMLElement,
  texts: readonly string[],
): Promise<void> {
  const gen = warmGen;
  const pack = loadedPack ?? await loadOrCapturePack(host);
  if (gen !== warmGen) return;
  await applyAmountsSection(pack);
  await warmAmounts(host, texts);
  const { entries, blobs } = await exportAmountPngBlobs();
  const unchanged =
    entries.length === pack.meta.amountEntries.length &&
    entries.every((e, i) => e === pack.meta.amountEntries[i]);
  if (unchanged) return;
  pack.meta.amountEntries = entries;
  const base = pack.blobs.slice(0, OFF_AMOUNTS);
  pack.blobs = [...base, ...blobs];
  loadedPack = pack;
  void saveSprites({
    key: pack.key,
    meta: pack.meta,
    blobs: pack.blobs,
  });
}
