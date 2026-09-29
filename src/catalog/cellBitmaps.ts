/**
 * Closed set of cell bitmaps, captured once per layout and pixel ratio.
 * Each number is SnapDOM of a real ticket cell (same CSS as live DOM), un-matted
 * to transparent ink. A ticket blits six of them. Hits swap in
 * the dab or a multiplier. Header amount and ticket id are painted separately.
 */

import { deleteSprites, loadSpritesMany, saveSprites } from "./atlasStore";
import { captureAllCellNumbers } from "./cellNumberSnap";
import { activeDpr, spriteRasterDpr } from "./cellBoxModel";
import {
  BADGE_CAPTURE_PAD_X,
  badgeCapturePads,
  resolveTicketCellGeometry,
} from "./ticketCellGeometry";
import { getActiveLayout } from "./catalogLayout";
import { BALLS_PER_TICKET } from "./layout";
import { decodePngBlobsToBitmaps } from "./spriteDecodeClient";
import {
  bitmapSpriteToPngBlob,
  decodeStoredSpriteBlob,
  packBlobFromRasterCanvas,
  rasterizeTicketSvg,
  rasterSvgBlob,
  svgBlobToPngBlob,
} from "./ticketSvgRaster";
import { TicketCard } from "./ticketCardElement";
import { ensureTicketFont } from "./ticketFont";
import { MULTIPLIER_VALUES, type Ticket } from "./tickets";

const NUMBER_COUNT = 60;

/** Decoded IDB sprites skip the extra canvas blit; fresh captures stay as canvas. */
export type BitmapSprite = HTMLCanvasElement | ImageBitmap;

export type PlacedBitmap = {
  canvas: BitmapSprite;
  /** Horizontal pad baked into the badge SVG raster. */
  padX: number;
  /** Vertical pad (body padding Y) baked into the badge SVG raster. */
  padY: number;
};

export type CellBitmaps = {
  numbers: BitmapSprite[];
  dab: PlacedBitmap;
  multipliers: Map<number, PlacedBitmap>;
  /** Green-ticket cells and badges. Captured with the set, not from the 65-blob record. */
  disabledNumbers: BitmapSprite[];
  disabledDab: PlacedBitmap;
  disabledMultipliers: Map<number, PlacedBitmap>;
};

export const CELL_BLOB_COUNT = NUMBER_COUNT + 1 + MULTIPLIER_VALUES.length;
export const CELL_BADGE_PAD_CSS = BADGE_CAPTURE_PAD_X;

const sets = new Map<string, CellBitmaps>();
const pending = new Map<string, Promise<CellBitmaps>>();

export function cellBitmapCacheKey(): string {
  const layout = getActiveLayout();
  return `bmp-png-v11|${layout.metrics.id}|${layout.cardWidth}|plain-body`;
}

function bitmapKey(): string {
  return cellBitmapCacheKey();
}

const BMP_LEGACY_KEY = (): string => {
  const layout = getActiveLayout();
  return `bmp|${layout.metrics.id}|${layout.cardWidth}|${activeDpr()}`;
};

function disabledBitmapKey(): string {
  return `${bitmapKey()}|disabled`;
}

function numbersIdbKey(disabled: boolean): string {
  const layout = getActiveLayout();
  const suffix = disabled ? "|disabled" : "";
  return `bmp-numbers-png-v11|${layout.metrics.id}|${layout.cardWidth}|plain-body${suffix}`;
}

function dabIdbKey(disabled: boolean): string {
  const layout = getActiveLayout();
  const suffix = disabled ? "|disabled" : "";
  return `bmp-dab-png-v6|${layout.metrics.id}|${layout.cardWidth}|pdpr${suffix}`;
}

function multIdbKey(disabled: boolean): string {
  const layout = getActiveLayout();
  const suffix = disabled ? "|disabled" : "";
  return `bmp-mult-png-v6|${layout.metrics.id}|${layout.cardWidth}|pdpr${suffix}`;
}

async function numbersFromStoredBlobs(blobs: Blob[]): Promise<BitmapSprite[] | null> {
  if (blobs.length !== NUMBER_COUNT) return null;
  const sprites = await spritesFromStoredBlobs(blobs);
  const numbers: BitmapSprite[] = [];
  for (let n = 1; n <= NUMBER_COUNT; n++) {
    const sprite = sprites[n - 1];
    if (!sprite) return null;
    numbers[n] = sprite;
  }
  return numbers;
}

async function dabFromStoredBlob(blob: Blob): Promise<PlacedBitmap | null> {
  const sprites = await spritesFromStoredBlobs([blob]);
  const canvas = sprites[0];
  if (!canvas) return null;
  const { padX, padY } = badgeCapturePads();
  return { canvas, padX, padY };
}

async function multsFromStoredBlobs(blobs: Blob[]): Promise<Map<number, PlacedBitmap> | null> {
  if (blobs.length !== MULTIPLIER_VALUES.length) return null;
  const sprites = await spritesFromStoredBlobs(blobs);
  const pads = badgeCapturePads();
  const multipliers = new Map<number, PlacedBitmap>();
  for (let i = 0; i < MULTIPLIER_VALUES.length; i++) {
    const sprite = sprites[i];
    if (!sprite) return null;
    multipliers.set(MULTIPLIER_VALUES[i]!, {
      canvas: sprite,
      padX: pads.padX,
      padY: pads.padY,
    });
  }
  return multipliers;
}

function placedBadge(canvas: BitmapSprite): PlacedBitmap {
  const { padX, padY } = badgeCapturePads();
  return { canvas, padX, padY };
}

async function numbersBlobsOf(numbers: readonly BitmapSprite[]): Promise<Blob[] | null> {
  const out: Blob[] = [];
  for (let n = 1; n <= NUMBER_COUNT; n++) {
    const sprite = numbers[n];
    if (!sprite) return null;
    const blob = await spriteToPackBlob(sprite);
    if (!blob) return null;
    out.push(blob);
  }
  return out;
}

async function multBlobsOf(multipliers: Map<number, PlacedBitmap>): Promise<Blob[] | null> {
  const out: Blob[] = [];
  for (const value of MULTIPLIER_VALUES) {
    const sprite = multipliers.get(value)?.canvas;
    if (!sprite) return null;
    const blob = await spriteToPackBlob(sprite);
    if (!blob) return null;
    out.push(blob);
  }
  return out;
}

async function persistActiveCellParts(set: CellBitmaps): Promise<void> {
  const numBlobs = await numbersBlobsOf(set.numbers);
  if (numBlobs) {
    void saveSprites({
      key: numbersIdbKey(false),
      meta: { part: "numbers", padCss: BADGE_CAPTURE_PAD_X, format: "png" },
      blobs: numBlobs,
    });
  }
  const dabBlob = await spriteToPackBlob(set.dab.canvas);
  if (dabBlob) {
    void saveSprites({
      key: dabIdbKey(false),
      meta: { part: "dab", padCss: BADGE_CAPTURE_PAD_X, format: "png" },
      blobs: [dabBlob],
    });
  }
  const multBlobs = await multBlobsOf(set.multipliers);
  if (multBlobs) {
    void saveSprites({
      key: multIdbKey(false),
      meta: { part: "multipliers", padCss: BADGE_CAPTURE_PAD_X, format: "png" },
      blobs: multBlobs,
    });
  }
}

async function persistDisabledCellParts(set: CellBitmaps): Promise<void> {
  const numBlobs = await numbersBlobsOf(set.disabledNumbers);
  if (numBlobs) {
    void saveSprites({
      key: numbersIdbKey(true),
      meta: { part: "numbers", padCss: BADGE_CAPTURE_PAD_X, format: "png" },
      blobs: numBlobs,
    });
  }
  const dabBlob = await spriteToPackBlob(set.disabledDab.canvas);
  if (dabBlob) {
    void saveSprites({
      key: dabIdbKey(true),
      meta: { part: "dab", padCss: BADGE_CAPTURE_PAD_X, format: "png" },
      blobs: [dabBlob],
    });
  }
  const multBlobs = await multBlobsOf(set.disabledMultipliers);
  if (multBlobs) {
    void saveSprites({
      key: multIdbKey(true),
      meta: { part: "multipliers", padCss: BADGE_CAPTURE_PAD_X, format: "png" },
      blobs: multBlobs,
    });
  }
}

async function loadActivePartsFromIdb(): Promise<{
  numbers: BitmapSprite[];
  dab: PlacedBitmap;
  multipliers: Map<number, PlacedBitmap>;
} | null> {
  const keys = [numbersIdbKey(false), dabIdbKey(false), multIdbKey(false)];
  const [nStored, dStored, mStored] = await loadSpritesMany(keys);
  if (!nStored?.blobs.length || !dStored?.blobs[0] || !mStored?.blobs.length) {
    return null;
  }
  const numbers = await numbersFromStoredBlobs(nStored.blobs);
  const dab = await dabFromStoredBlob(dStored.blobs[0]!);
  const multipliers = await multsFromStoredBlobs(mStored.blobs);
  if (!numbers || !dab || !multipliers) return null;
  return { numbers, dab, multipliers };
}

async function loadDisabledPartsFromIdb(): Promise<{
  numbers: BitmapSprite[];
  dab: PlacedBitmap;
  multipliers: Map<number, PlacedBitmap>;
} | null> {
  const keys = [numbersIdbKey(true), dabIdbKey(true), multIdbKey(true)];
  const [nStored, dStored, mStored] = await loadSpritesMany(keys);
  if (!nStored?.blobs.length || !dStored?.blobs[0] || !mStored?.blobs.length) {
    return null;
  }
  const numbers = await numbersFromStoredBlobs(nStored.blobs);
  const dab = await dabFromStoredBlob(dStored.blobs[0]!);
  const multipliers = await multsFromStoredBlobs(mStored.blobs);
  if (!numbers || !dab || !multipliers) return null;
  return { numbers, dab, multipliers };
}

const CHROME_IDB = "chrome-v2-png";

const chromeCache = new Map<string, BitmapSprite>();
const chromePending = new Map<string, Promise<BitmapSprite>>();
const headerCache = new Map<string, HTMLCanvasElement>();

export function warmCellBitmaps(host: HTMLElement): Promise<CellBitmaps> {
  const key = bitmapKey();
  const hit = sets.get(key);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const run = loadOrCapture(host, key).then(
    (set) => {
      sets.set(key, set);
      if (pending.get(key) === run) pending.delete(key);
      return set;
    },
    (err: unknown) => {
      if (pending.get(key) === run) pending.delete(key);
      throw err;
    },
  );
  pending.set(key, run);
  return run;
}

export function getCellBitmaps(): CellBitmaps | null {
  return sets.get(bitmapKey()) ?? null;
}

function isPngPack(blobs: readonly Blob[]): boolean {
  const t = blobs[0]?.type ?? "";
  return t.includes("png");
}

async function spritesFromStoredBlobs(blobs: Blob[]): Promise<(BitmapSprite | null)[]> {
  if (isPngPack(blobs)) {
    try {
      return await decodePngBlobsToBitmaps(blobs);
    } catch {
      return blobs.map(() => null);
    }
  }
  return Promise.all(
    blobs.map((b) => decodeStoredSpriteBlob(b).catch(() => null)),
  );
}

export async function cellBitmapsFromActiveBlobs(blobs: Blob[]): Promise<CellBitmaps | null> {
  return fromBlobs(blobs);
}

async function fromBlobs(blobs: Blob[]): Promise<CellBitmaps | null> {
  const sprites = await spritesFromStoredBlobs(blobs);
  const numbers: BitmapSprite[] = [];
  for (let n = 1; n <= NUMBER_COUNT; n++) {
    const sprite = sprites[n - 1];
    if (!sprite) return null;
    numbers[n] = sprite;
  }
  const dabCanvas = sprites[NUMBER_COUNT];
  if (!dabCanvas) return null;
  const pads = badgeCapturePads();
  const multipliers = new Map<number, PlacedBitmap>();
  for (let i = 0; i < MULTIPLIER_VALUES.length; i++) {
    const sprite = sprites[NUMBER_COUNT + 1 + i];
    if (!sprite) return null;
    multipliers.set(MULTIPLIER_VALUES[i]!, {
      canvas: sprite,
      padX: pads.padX,
      padY: pads.padY,
    });
  }
  const dab = placedBadge(dabCanvas);
  return {
    numbers,
    dab,
    multipliers,
    disabledNumbers: [],
    disabledDab: dab,
    disabledMultipliers: new Map(),
  };
}

async function spriteToPackBlob(sprite: BitmapSprite): Promise<Blob | null> {
  try {
    if (sprite instanceof HTMLCanvasElement) {
      return await packBlobFromRasterCanvas(sprite);
    }
    if (sprite instanceof ImageBitmap) {
      return await bitmapSpriteToPngBlob(sprite);
    }
    return null;
  } catch {
    return null;
  }
}

async function blobsOf(set: CellBitmaps): Promise<Blob[] | null> {
  const out: Blob[] = [];
  for (let n = 1; n <= NUMBER_COUNT; n++) {
    const sprite = set.numbers[n];
    if (!sprite) return null;
    const blob = await spriteToPackBlob(sprite);
    if (!blob) return null;
    out.push(blob);
  }
  const dabBlob = await spriteToPackBlob(set.dab.canvas);
  if (!dabBlob) return null;
  out.push(dabBlob);
  for (const value of MULTIPLIER_VALUES) {
    const sprite = set.multipliers.get(value)?.canvas;
    if (!sprite) return null;
    const blob = await spriteToPackBlob(sprite);
    if (!blob) return null;
    out.push(blob);
  }
  return out;
}

async function disabledBlobsOf(set: CellBitmaps): Promise<Blob[] | null> {
  const out: Blob[] = [];
  for (let n = 1; n <= NUMBER_COUNT; n++) {
    const sprite = set.disabledNumbers[n];
    if (!sprite) return null;
    const blob = await spriteToPackBlob(sprite);
    if (!blob) return null;
    out.push(blob);
  }
  const dabBlob = await spriteToPackBlob(set.disabledDab.canvas);
  if (!dabBlob) return null;
  out.push(dabBlob);
  for (const value of MULTIPLIER_VALUES) {
    const sprite = set.disabledMultipliers.get(value)?.canvas;
    if (!sprite) return null;
    const blob = await spriteToPackBlob(sprite);
    if (!blob) return null;
    out.push(blob);
  }
  return out;
}

export async function applyDisabledCellBlobs(
  set: CellBitmaps,
  blobs: Blob[],
): Promise<boolean> {
  const disabled = await disabledFromBlobs(blobs);
  if (!disabled) return false;
  set.disabledNumbers = disabled.disabledNumbers;
  set.disabledDab = disabled.disabledDab;
  set.disabledMultipliers = disabled.disabledMultipliers;
  return true;
}

export function cacheCellBitmaps(set: CellBitmaps): void {
  sets.set(bitmapKey(), set);
}

export async function exportActiveCellPngBlobs(set: CellBitmaps): Promise<Blob[] | null> {
  return blobsOf(set);
}

export async function exportDisabledCellPngBlobs(set: CellBitmaps): Promise<Blob[] | null> {
  return disabledBlobsOf(set);
}

export async function captureActiveCellSet(host: HTMLElement): Promise<CellBitmaps> {
  return captureSet(host);
}

export async function captureDisabledCellSet(
  host: HTMLElement,
): Promise<Pick<CellBitmaps, "disabledNumbers" | "disabledDab" | "disabledMultipliers">> {
  const part = await captureDisabledBadges(host);
  return {
    disabledNumbers: part.numbers,
    disabledDab: part.dab,
    disabledMultipliers: part.multipliers,
  };
}

export function cacheTicketChrome(
  win: boolean,
  disabled: boolean,
  sprite: BitmapSprite,
): void {
  chromeCache.set(chromeRamKey(win, disabled), sprite);
}

export async function captureTicketChromeBitmap(
  host: HTMLElement,
  win: boolean,
  disabled = false,
): Promise<HTMLCanvasElement> {
  return captureChrome(host, win, disabled);
}

export async function chromePackBlobFromCanvas(
  canvas: HTMLCanvasElement,
): Promise<Blob | null> {
  try {
    return await packBlobFromRasterCanvas(canvas);
  } catch {
    return null;
  }
}

async function disabledFromBlobs(
  blobs: Blob[],
): Promise<Pick<CellBitmaps, "disabledNumbers" | "disabledDab" | "disabledMultipliers"> | null> {
  const full = await fromBlobs(blobs);
  if (!full) return null;
  return {
    disabledNumbers: full.numbers,
    disabledDab: full.dab,
    disabledMultipliers: full.multipliers,
  };
}

async function loadOrCapture(host: HTMLElement, key: string): Promise<CellBitmaps> {
  const dKey = disabledBitmapKey();
  const legacyKey = BMP_LEGACY_KEY();
  const legacyDKey = `${legacyKey}|disabled`;

  let activeParts = await loadActivePartsFromIdb();
  if (!activeParts) {
    let [stored] = await loadSpritesMany([key]);
    if (!stored?.blobs?.length) {
      [stored] = await loadSpritesMany([legacyKey]);
    }
    if (stored && stored.blobs.length === CELL_BLOB_COUNT) {
      const legacy = await fromBlobs(stored.blobs);
      if (legacy) {
        activeParts = {
          numbers: legacy.numbers,
          dab: legacy.dab,
          multipliers: legacy.multipliers,
        };
        void persistActiveCellParts(legacy);
      } else {
        void deleteSprites(key);
      }
    }
  }

  let set: CellBitmaps;
  if (activeParts) {
    set = {
      numbers: activeParts.numbers,
      dab: activeParts.dab,
      multipliers: activeParts.multipliers,
      disabledNumbers: [],
      disabledDab: activeParts.dab,
      disabledMultipliers: new Map(),
    };
  } else {
    set = await captureSet(host);
    void persistActiveCellParts(set);
  }

  let disabledParts = await loadDisabledPartsFromIdb();
  if (!disabledParts) {
    let [dStored] = await loadSpritesMany([dKey]);
    if (!dStored?.blobs?.length) {
      [dStored] = await loadSpritesMany([legacyDKey]);
    }
    if (dStored && dStored.blobs.length === CELL_BLOB_COUNT) {
      const legacy = await disabledFromBlobs(dStored.blobs);
      if (legacy) {
        disabledParts = {
          numbers: legacy.disabledNumbers,
          dab: legacy.disabledDab,
          multipliers: legacy.disabledMultipliers,
        };
        set.disabledNumbers = legacy.disabledNumbers;
        set.disabledDab = legacy.disabledDab;
        set.disabledMultipliers = legacy.disabledMultipliers;
        void persistDisabledCellParts(set);
        return set;
      }
    }
  }

  if (disabledParts) {
    set.disabledNumbers = disabledParts.numbers;
    set.disabledDab = disabledParts.dab;
    set.disabledMultipliers = disabledParts.multipliers;
    return set;
  }

  const disabled = await captureDisabledBadges(host);
  set.disabledNumbers = disabled.numbers;
  set.disabledDab = disabled.dab;
  set.disabledMultipliers = disabled.multipliers;
  void persistDisabledCellParts(set);
  return set;
}

function chromeRamKey(win: boolean, disabled: boolean): string {
  const layout = getActiveLayout();
  const face = disabled ? "disabled" : win ? "win" : "plain";
  return `${layout.metrics.id}|${layout.cardWidth}|pdpr|${face}`;
}

function chromeIdbKey(win: boolean, disabled: boolean): string {
  return `${CHROME_IDB}|${chromeRamKey(win, disabled)}`;
}

/** Already-captured card face, or null while the chrome raster is still warming. */
export function peekTicketChrome(win: boolean, disabled = false): BitmapSprite | null {
  return chromeCache.get(chromeRamKey(win, disabled)) ?? null;
}

/**
 * Gold (or plain) card face, header wash, and separators. No digits, badges,
 * amount, or ticket id — those are blitted on top.
 */
export function ticketChrome(
  host: HTMLElement,
  win: boolean,
  disabled = false,
): Promise<BitmapSprite> {
  const key = chromeRamKey(win, disabled);
  const hit = chromeCache.get(key);
  if (hit) return Promise.resolve(hit);
  const inflight = chromePending.get(key);
  if (inflight) return inflight;
  const run = (async () => {
    const idbKey = chromeIdbKey(win, disabled);
    const legacyIdb = `chrome-v1|${key}`;
    let stored = (await loadSpritesMany([idbKey]))[0];
    if (!stored?.blobs[0]) stored = (await loadSpritesMany([legacyIdb]))[0] ?? null;
    if (stored?.blobs[0]) {
      const sprites = await spritesFromStoredBlobs(stored.blobs);
      const sprite = sprites[0];
      if (sprite) {
        chromeCache.set(key, sprite);
        if (!isPngPack(stored.blobs) && stored.blobs[0]) {
          void svgBlobToPngBlob(stored.blobs[0]).then((png) => {
            if (!png) return;
            return saveSprites({
              key: idbKey,
              meta: { face: key, format: "png" },
              blobs: [png],
            });
          });
        }
        return sprite;
      }
    }
    const canvas = await captureChrome(host, win, disabled);
    const svg = rasterSvgBlob(canvas);
    if (svg) {
      const png = await svgBlobToPngBlob(svg);
      if (png) {
        void saveSprites({ key: idbKey, meta: { face: key, format: "png" }, blobs: [png] });
      } else {
        void saveSprites({ key: idbKey, meta: { face: key, format: "svg" }, blobs: [svg] });
      }
    }
    chromeCache.set(key, canvas);
    return canvas;
  })().finally(() => {
    if (chromePending.get(key) === run) chromePending.delete(key);
  });
  chromePending.set(key, run);
  return run;
}

/** One header run (amount or ticket id), cached by the string and the win look. */
export async function headerSlice(
  el: HTMLElement,
  key: string,
): Promise<HTMLCanvasElement> {
  const full = `${getActiveLayout().metrics.id}|${activeDpr()}|${key}`;
  const hit = headerCache.get(full);
  if (hit) return hit;
  await ensureTicketFont(getActiveLayout().metrics.metaFontSize);
  const canvas = await rasterizeTicketSvg(el, spriteRasterDpr());
  headerCache.set(full, canvas);
  return canvas;
}

function clearInk(root: HTMLElement): void {
  root.querySelectorAll(".ticketCard__win, .ticketCard__id, .ticketCard__cell").forEach((el) => {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) (node as Text).data = "";
    }
  });
  root.querySelectorAll(".ticketCard__badgeHost").forEach((el) => {
    (el as HTMLElement).style.display = "none";
  });
}

async function captureChrome(
  host: HTMLElement,
  win: boolean,
  disabled = false,
): Promise<HTMLCanvasElement> {
  const paintDpr = activeDpr();
  await ensureTicketFont(getActiveLayout().metrics.metaFontSize);
  const card = new TicketCard();
  card.dom.style.position = "fixed";
  card.dom.style.left = "-10000px";
  card.dom.style.top = "0";
  host.appendChild(card.dom);
  try {
    card.bind(chromeTicket(win, disabled));
    clearInk(card.dom);
    return await rasterizeTicketSvg(card.dom, paintDpr);
  } finally {
    card.dom.remove();
  }
}

function chromeTicket(win: boolean, disabled = false): Ticket {
  return {
    id: "cell-bitmap-chrome",
    no: "",
    balls: Array.from({ length: BALLS_PER_TICKET }, () => 1),
    hits: win ? [0, 1] : [],
    multipliers: {},
    win: "",
    disabled,
  };
}

async function captureDisabledBadges(host: HTMLElement): Promise<{
  numbers: BitmapSprite[];
  dab: PlacedBitmap;
  multipliers: Map<number, PlacedBitmap>;
}> {
  const paintDpr = activeDpr();
  await ensureTicketFont(getActiveLayout().metrics.numberFontSize);
  const card = new TicketCard();
  card.dom.style.position = "fixed";
  card.dom.style.left = "-10000px";
  card.dom.style.top = "0";
  host.appendChild(card.dom);
  try {
    card.applyCardWidth(getActiveLayout().cardWidth, true);
    const numbers = await captureAllCellNumbers(
      host,
      card.dom,
      paintDpr,
      (ball) => card.bind(sourceTicket(ball, false, 0, true)),
    );
    card.bind(sourceTicket(1, true, 0, true));
    const dab = placedBadge(await captureBadgeHost(card, paintDpr));
    const multipliers = new Map<number, PlacedBitmap>();
    for (const value of MULTIPLIER_VALUES) {
      card.bind(sourceTicket(1, true, value, true));
      multipliers.set(value, placedBadge(await captureBadgeHost(card, paintDpr)));
    }
    return { numbers, dab, multipliers };
  } finally {
    card.dom.remove();
  }
}

function sourceTicket(ball: number, hit: boolean, mult: number, disabled = false): Ticket {
  const balls = Array.from({ length: BALLS_PER_TICKET }, () => 1);
  balls[0] = ball;
  return {
    id: "cell-bitmap-src",
    no: "0",
    balls,
    // No win chrome for digit capture (hits.length must stay < WIN_MATCH_THRESHOLD).
    hits: hit ? [0] : [],
    multipliers: mult > 0 ? { 0: mult } : {},
    win: "",
    disabled,
  };
}

function badgeCapturePad(dpr: number): { x: number; y: number } {
  const geo = resolveTicketCellGeometry(getActiveLayout(), dpr);
  return { x: BADGE_CAPTURE_PAD_X, y: geo.bodyPaddingY };
}

async function captureBadgeHost(
  card: TicketCard,
  dpr: number,
): Promise<HTMLCanvasElement> {
  const host = card.dom.querySelector(".ticketCard__badgeHost");
  if (!host) throw new Error("badge host missing");
  return rasterizeTicketSvg(host as HTMLElement, dpr, badgeCapturePad(dpr));
}

async function captureSet(host: HTMLElement): Promise<CellBitmaps> {
  const paintDpr = activeDpr();
  const fontPx = getActiveLayout().metrics.numberFontSize;
  await ensureTicketFont(fontPx);

  const card = new TicketCard();
  card.dom.style.position = "fixed";
  card.dom.style.left = "-10000px";
  card.dom.style.top = "0";
  host.appendChild(card.dom);

  try {
    card.applyCardWidth(getActiveLayout().cardWidth, true);
    const numbers = await captureAllCellNumbers(
      host,
      card.dom,
      paintDpr,
      (ball) => card.bind(sourceTicket(ball, false, 0)),
    );

    card.bind(sourceTicket(1, true, 0));
    const dab = placedBadge(await captureBadgeHost(card, paintDpr));

    const multipliers = new Map<number, PlacedBitmap>();
    for (const value of MULTIPLIER_VALUES) {
      card.bind(sourceTicket(1, true, value));
      multipliers.set(value, placedBadge(await captureBadgeHost(card, paintDpr)));
    }

    return {
      numbers,
      dab,
      multipliers,
      disabledNumbers: [],
      disabledDab: dab,
      disabledMultipliers: new Map(),
    };
  } finally {
    card.dom.remove();
  }
}
