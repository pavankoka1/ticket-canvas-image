/**
 * Closed set of cell bitmaps, captured once per layout and pixel ratio.
 * Each bitmap is the real cell (styles inlined, foreignObject raster), so
 * its origin is the cell origin. A ticket blits six of them. Hits swap in
 * the dab or a multiplier. Header amount and ticket id are painted separately.
 */

import { loadSpritesMany, saveSprites } from "./atlasStore";
import { activeDpr } from "./cellBoxModel";
import { getActiveLayout } from "./catalogLayout";
import { BALLS_PER_TICKET } from "./layout";
import { decodePngBlobsToBitmaps } from "./spriteDecodeClient";
import {
  decodeStoredSpriteBlob,
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

export type PlacedBitmap = { canvas: BitmapSprite; padCss: number };

export type CellBitmaps = {
  numbers: BitmapSprite[];
  dab: PlacedBitmap;
  multipliers: Map<number, PlacedBitmap>;
  /** Green-ticket cells and badges. Captured with the set, not from the 65-blob record. */
  disabledNumbers: BitmapSprite[];
  disabledDab: PlacedBitmap;
  disabledMultipliers: Map<number, PlacedBitmap>;
};

/** Room for the rotated N×, which sticks out of the badge box. */
const BADGE_PAD_CSS = 16;

const CELL_BLOB_COUNT = NUMBER_COUNT + 1 + MULTIPLIER_VALUES.length;

const sets = new Map<string, CellBitmaps>();
const pending = new Map<string, Promise<CellBitmaps>>();

function bitmapKey(): string {
  const layout = getActiveLayout();
  return `bmp-png|${layout.metrics.id}|${layout.cardWidth}|${activeDpr()}`;
}

const BMP_LEGACY_KEY = (): string => {
  const layout = getActiveLayout();
  return `bmp|${layout.metrics.id}|${layout.cardWidth}|${activeDpr()}`;
};

function disabledBitmapKey(): string {
  return `${bitmapKey()}|disabled`;
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
  const multipliers = new Map<number, PlacedBitmap>();
  for (let i = 0; i < MULTIPLIER_VALUES.length; i++) {
    const sprite = sprites[NUMBER_COUNT + 1 + i];
    if (!sprite) return null;
    multipliers.set(MULTIPLIER_VALUES[i]!, { canvas: sprite, padCss: BADGE_PAD_CSS });
  }
  return {
    numbers,
    dab: { canvas: dabCanvas, padCss: BADGE_PAD_CSS },
    multipliers,
    disabledNumbers: [],
    disabledDab: { canvas: dabCanvas, padCss: BADGE_PAD_CSS },
    disabledMultipliers: new Map(),
  };
}

function exportSvgBlob(sprite: BitmapSprite): Blob | undefined {
  return sprite instanceof HTMLCanvasElement ? rasterSvgBlob(sprite) : undefined;
}

async function svgBlobsToPngPack(svgBlobs: Blob[]): Promise<Blob[] | null> {
  try {
    return await Promise.all(svgBlobs.map((b) => svgBlobToPngBlob(b)));
  } catch {
    return null;
  }
}

async function blobsOf(set: CellBitmaps): Promise<Blob[] | null> {
  const svgBlobs: Blob[] = [];
  for (let n = 1; n <= NUMBER_COUNT; n++) {
    const blob = exportSvgBlob(set.numbers[n]!);
    if (!blob) return null;
    svgBlobs.push(blob);
  }
  const dab = exportSvgBlob(set.dab.canvas);
  if (!dab) return null;
  svgBlobs.push(dab);
  for (const value of MULTIPLIER_VALUES) {
    const blob = exportSvgBlob(set.multipliers.get(value)!.canvas);
    if (!blob) return null;
    svgBlobs.push(blob);
  }
  return svgBlobsToPngPack(svgBlobs);
}

async function disabledBlobsOf(set: CellBitmaps): Promise<Blob[] | null> {
  const svgBlobs: Blob[] = [];
  for (let n = 1; n <= NUMBER_COUNT; n++) {
    const blob = exportSvgBlob(set.disabledNumbers[n]!);
    if (!blob) return null;
    svgBlobs.push(blob);
  }
  const dab = exportSvgBlob(set.disabledDab.canvas);
  if (!dab) return null;
  svgBlobs.push(dab);
  for (const value of MULTIPLIER_VALUES) {
    const blob = exportSvgBlob(set.disabledMultipliers.get(value)!.canvas);
    if (!blob) return null;
    svgBlobs.push(blob);
  }
  return svgBlobsToPngPack(svgBlobs);
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
  let [stored, dStored] = await loadSpritesMany([key, dKey]);
  if (!stored?.blobs?.length) {
    [stored, dStored] = await loadSpritesMany([legacyKey, legacyDKey]);
  }
  let set: CellBitmaps | null = null;
  if (stored && stored.blobs.length === CELL_BLOB_COUNT) {
    set = await fromBlobs(stored.blobs);
  }
  if (!set) {
    set = await captureSet(host);
    const blobs = await blobsOf(set);
    if (blobs) void saveSprites({ key, meta: { padCss: BADGE_PAD_CSS, format: "png" }, blobs });
  }

  if (dStored && dStored.blobs.length === CELL_BLOB_COUNT) {
    const disabled = await disabledFromBlobs(dStored.blobs);
    if (disabled) {
      set.disabledNumbers = disabled.disabledNumbers;
      set.disabledDab = disabled.disabledDab;
      set.disabledMultipliers = disabled.disabledMultipliers;
      if (!isPngPack(dStored.blobs)) {
        const migrated = await disabledBlobsOf(set);
        if (migrated) void saveSprites({ key: dKey, meta: { padCss: BADGE_PAD_CSS, format: "png" }, blobs: migrated });
      }
      return set;
    }
  }

  const disabled = await captureDisabledBadges(host);
  set.disabledNumbers = disabled.numbers;
  set.disabledDab = disabled.dab;
  set.disabledMultipliers = disabled.multipliers;
  const dBlobs = await disabledBlobsOf(set);
  if (dBlobs) void saveSprites({ key: dKey, meta: { padCss: BADGE_PAD_CSS, format: "png" }, blobs: dBlobs });
  return set;
}

function chromeRamKey(win: boolean, disabled: boolean): string {
  const layout = getActiveLayout();
  const face = disabled ? "disabled" : win ? "win" : "plain";
  return `${layout.metrics.id}|${layout.cardWidth}|${activeDpr()}|${face}`;
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
          void svgBlobToPngBlob(stored.blobs[0]).then((png) =>
            saveSprites({ key: idbKey, meta: { face: key, format: "png" }, blobs: [png] }),
          );
        }
        return sprite;
      }
    }
    const canvas = await captureChrome(host, win, disabled);
    const svg = rasterSvgBlob(canvas);
    if (svg) {
      const png = await svgBlobToPngBlob(svg);
      void saveSprites({ key: idbKey, meta: { face: key, format: "png" }, blobs: [png] });
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
  const canvas = await rasterizeTicketSvg(el, activeDpr());
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
  const dpr = activeDpr();
  await ensureTicketFont(getActiveLayout().metrics.metaFontSize);
  const card = new TicketCard();
  card.dom.style.position = "fixed";
  card.dom.style.left = "-10000px";
  card.dom.style.top = "0";
  host.appendChild(card.dom);
  try {
    card.bind(chromeTicket(win, disabled));
    clearInk(card.dom);
    return await rasterizeTicketSvg(card.dom, dpr);
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
  const dpr = activeDpr();
  await ensureTicketFont(getActiveLayout().metrics.numberFontSize);
  const card = new TicketCard();
  card.dom.style.position = "fixed";
  card.dom.style.left = "-10000px";
  card.dom.style.top = "0";
  host.appendChild(card.dom);
  try {
    const numbers: BitmapSprite[] = [];
    for (let n = 1; n <= NUMBER_COUNT; n++) {
      card.bind(sourceTicket(n, false, 0, true));
      numbers[n] = await captureCell(card, dpr);
    }
    card.bind(sourceTicket(1, true, 0, true));
    const dab = {
      canvas: await rasterizeTicketSvg(
        card.dom.querySelector(".ticketCard__badgeHost") as HTMLElement,
        dpr,
        BADGE_PAD_CSS,
      ),
      padCss: BADGE_PAD_CSS,
    };
    const multipliers = new Map<number, PlacedBitmap>();
    for (const value of MULTIPLIER_VALUES) {
      card.bind(sourceTicket(1, true, value, true));
      multipliers.set(value, {
        canvas: await rasterizeTicketSvg(
          card.dom.querySelector(".ticketCard__badgeHost") as HTMLElement,
          dpr,
          BADGE_PAD_CSS,
        ),
        padCss: BADGE_PAD_CSS,
      });
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
    hits: hit ? [0, 1] : [1, 2],
    multipliers: mult > 0 ? { 0: mult } : {},
    win: "$0.00",
    disabled,
  };
}

async function captureCell(card: TicketCard, dpr: number): Promise<HTMLCanvasElement> {
  const cell = card.dom.querySelector(".ticketCard__cell");
  if (!cell) throw new Error("cell bitmap source missing");
  return rasterizeTicketSvg(cell as HTMLElement, dpr);
}

async function captureSet(host: HTMLElement): Promise<CellBitmaps> {
  const dpr = activeDpr();
  const fontPx = getActiveLayout().metrics.numberFontSize;
  await ensureTicketFont(fontPx);

  const card = new TicketCard();
  card.dom.style.position = "fixed";
  card.dom.style.left = "-10000px";
  card.dom.style.top = "0";
  host.appendChild(card.dom);

  try {
    const numbers: BitmapSprite[] = [];
    for (let n = 1; n <= NUMBER_COUNT; n++) {
      card.bind(sourceTicket(n, false, 0));
      numbers[n] = await captureCell(card, dpr);
    }

    card.bind(sourceTicket(1, true, 0));
    const dab = {
      canvas: await rasterizeTicketSvg(
        card.dom.querySelector(".ticketCard__badgeHost") as HTMLElement,
        dpr,
        BADGE_PAD_CSS,
      ),
      padCss: BADGE_PAD_CSS,
    };

    const multipliers = new Map<number, PlacedBitmap>();
    for (const value of MULTIPLIER_VALUES) {
      card.bind(sourceTicket(1, true, value));
      multipliers.set(value, {
        canvas: await rasterizeTicketSvg(
          card.dom.querySelector(".ticketCard__badgeHost") as HTMLElement,
          dpr,
          BADGE_PAD_CSS,
        ),
        padCss: BADGE_PAD_CSS,
      });
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
