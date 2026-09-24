/**
 * Closed set of cell bitmaps, captured once per layout and pixel ratio.
 * Each bitmap is the real cell (styles inlined, foreignObject raster), so
 * its origin is the cell origin. A ticket blits six of them. Hits swap in
 * the dab or a multiplier. Header amount and ticket id are painted separately.
 */

import { loadSprites, saveSprites } from "./atlasStore";
import { activeDpr } from "./cellBoxModel";
import { getActiveLayout } from "./catalogLayout";
import { BALLS_PER_TICKET } from "./layout";
import { rasterizeTicketSvg, rasterSvgBlob } from "./ticketSvgRaster";
import { TicketCard } from "./ticketCardElement";
import { ensureTicketFont } from "./ticketFont";
import { MULTIPLIER_VALUES, type Ticket } from "./tickets";

const NUMBER_COUNT = 60;

export type PlacedBitmap = { canvas: HTMLCanvasElement; padCss: number };

export type CellBitmaps = {
  numbers: HTMLCanvasElement[];
  dab: PlacedBitmap;
  multipliers: Map<number, PlacedBitmap>;
  /** Green-ticket cells and badges. Captured with the set, not from the 65-blob record. */
  disabledNumbers: HTMLCanvasElement[];
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
  return `bmp|${layout.metrics.id}|${layout.cardWidth}|${activeDpr()}`;
}

const chromeCache = new Map<string, HTMLCanvasElement>();
const chromePending = new Map<string, Promise<HTMLCanvasElement>>();
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

async function canvasFromSvg(blob: Blob): Promise<HTMLCanvasElement | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp.close();
      return null;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return canvas;
  } catch {
    return null;
  }
}

async function fromBlobs(blobs: Blob[]): Promise<CellBitmaps | null> {
  const canvases = await Promise.all(blobs.map(canvasFromSvg));
  const numbers: HTMLCanvasElement[] = [];
  for (let n = 1; n <= NUMBER_COUNT; n++) {
    const canvas = canvases[n - 1];
    if (!canvas) return null;
    numbers[n] = canvas;
  }
  const dabCanvas = canvases[NUMBER_COUNT];
  if (!dabCanvas) return null;
  const multipliers = new Map<number, PlacedBitmap>();
  for (let i = 0; i < MULTIPLIER_VALUES.length; i++) {
    const canvas = canvases[NUMBER_COUNT + 1 + i];
    if (!canvas) return null;
    multipliers.set(MULTIPLIER_VALUES[i]!, { canvas, padCss: BADGE_PAD_CSS });
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

function blobsOf(set: CellBitmaps): Blob[] | null {
  const blobs: Blob[] = [];
  for (let n = 1; n <= NUMBER_COUNT; n++) {
    const blob = rasterSvgBlob(set.numbers[n]!);
    if (!blob) return null;
    blobs.push(blob);
  }
  const dab = rasterSvgBlob(set.dab.canvas);
  if (!dab) return null;
  blobs.push(dab);
  for (const value of MULTIPLIER_VALUES) {
    const blob = rasterSvgBlob(set.multipliers.get(value)!.canvas);
    if (!blob) return null;
    blobs.push(blob);
  }
  return blobs;
}

async function loadOrCapture(host: HTMLElement, key: string): Promise<CellBitmaps> {
  const stored = await loadSprites(key);
  let set: CellBitmaps | null = null;
  if (stored && stored.blobs.length === CELL_BLOB_COUNT) {
    set = await fromBlobs(stored.blobs);
  }
  if (!set) {
    set = await captureSet(host);
    const blobs = blobsOf(set);
    if (blobs) void saveSprites({ key, meta: { padCss: BADGE_PAD_CSS }, blobs });
  }
  const disabled = await captureDisabledBadges(host);
  set.disabledNumbers = disabled.numbers;
  set.disabledDab = disabled.dab;
  set.disabledMultipliers = disabled.multipliers;
  return set;
}

/** Already-captured card face, or null while the chrome raster is still warming. */
export function peekTicketChrome(win: boolean, disabled = false): HTMLCanvasElement | null {
  const layout = getActiveLayout();
  const face = disabled ? "disabled" : win ? "win" : "plain";
  const key = `${layout.metrics.id}|${layout.cardWidth}|${activeDpr()}|${face}`;
  return chromeCache.get(key) ?? null;
}

/**
 * Gold (or plain) card face, header wash, and separators. No digits, badges,
 * amount, or ticket id — those are blitted on top.
 */
export function ticketChrome(
  host: HTMLElement,
  win: boolean,
  disabled = false,
): Promise<HTMLCanvasElement> {
  const layout = getActiveLayout();
  const face = disabled ? "disabled" : win ? "win" : "plain";
  const key = `${layout.metrics.id}|${layout.cardWidth}|${activeDpr()}|${face}`;
  const hit = chromeCache.get(key);
  if (hit) return Promise.resolve(hit);
  const inflight = chromePending.get(key);
  if (inflight) return inflight;
  const run = captureChrome(host, win, disabled).then(
    (canvas) => {
      chromeCache.set(key, canvas);
      if (chromePending.get(key) === run) chromePending.delete(key);
      return canvas;
    },
    (err: unknown) => {
      if (chromePending.get(key) === run) chromePending.delete(key);
      throw err;
    },
  );
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
  numbers: HTMLCanvasElement[];
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
    const numbers: HTMLCanvasElement[] = [];
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
    const numbers: HTMLCanvasElement[] = [];
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
