/**
 * Closed set of cell bitmaps, captured once per layout and pixel ratio.
 * Each bitmap is the real cell (styles inlined, foreignObject raster), so
 * its origin is the cell origin. A ticket blits six of them. Hits swap in
 * the dab or a multiplier. Header amount and ticket id are painted separately.
 */

import { activeDpr } from "./cellBoxModel";
import { getActiveLayout } from "./catalogLayout";
import { BALLS_PER_TICKET } from "./layout";
import { rasterizeTicketSvg } from "./ticketSvgRaster";
import { TicketCard } from "./ticketCardElement";
import { ensureTicketFont } from "./ticketFont";
import { MULTIPLIER_VALUES, type Ticket } from "./tickets";

const NUMBER_COUNT = 60;

export type PlacedBitmap = { canvas: HTMLCanvasElement; padCss: number };

export type CellBitmaps = {
  numbers: HTMLCanvasElement[];
  dab: PlacedBitmap;
  multipliers: Map<number, PlacedBitmap>;
};

/** Room for the rotated N×, which sticks out of the badge box. */
const BADGE_PAD_CSS = 16;

let cacheKey = "";
let cache: CellBitmaps | null = null;
let pending: Promise<CellBitmaps> | null = null;

const chromeCache = new Map<string, HTMLCanvasElement>();
const chromePending = new Map<string, Promise<HTMLCanvasElement>>();
const headerCache = new Map<string, HTMLCanvasElement>();

export function warmCellBitmaps(host: HTMLElement): Promise<CellBitmaps> {
  const key = `${getActiveLayout().metrics.id}|${activeDpr()}`;
  if (cache && cacheKey === key) return Promise.resolve(cache);
  if (pending && cacheKey === key) return pending;
  cacheKey = key;
  cache = null;
  const run = captureSet(host).then(
    (set) => {
      if (cacheKey === key) cache = set;
      if (pending === run) pending = null;
      return set;
    },
    (err: unknown) => {
      if (pending === run) pending = null;
      if (cacheKey === key) cacheKey = "";
      throw err;
    },
  );
  pending = run;
  return run;
}

export function getCellBitmaps(): CellBitmaps | null {
  return cache;
}

/** Already-captured card face, or null while the chrome raster is still warming. */
export function peekTicketChrome(win: boolean): HTMLCanvasElement | null {
  const key = `${getActiveLayout().metrics.id}|${activeDpr()}|${win ? "win" : "plain"}`;
  return chromeCache.get(key) ?? null;
}

/**
 * Gold (or plain) card face, header wash, and separators. No digits, badges,
 * amount, or ticket id — those are blitted on top.
 */
export function ticketChrome(
  host: HTMLElement,
  win: boolean,
): Promise<HTMLCanvasElement> {
  const key = `${getActiveLayout().metrics.id}|${activeDpr()}|${win ? "win" : "plain"}`;
  const hit = chromeCache.get(key);
  if (hit) return Promise.resolve(hit);
  const inflight = chromePending.get(key);
  if (inflight) return inflight;
  const run = captureChrome(host, win).then(
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

async function captureChrome(host: HTMLElement, win: boolean): Promise<HTMLCanvasElement> {
  const dpr = activeDpr();
  await ensureTicketFont(getActiveLayout().metrics.metaFontSize);
  const card = new TicketCard();
  card.dom.style.position = "fixed";
  card.dom.style.left = "-10000px";
  card.dom.style.top = "0";
  host.appendChild(card.dom);
  try {
    card.bind(chromeTicket(win));
    clearInk(card.dom);
    return await rasterizeTicketSvg(card.dom, dpr);
  } finally {
    card.dom.remove();
  }
}

function chromeTicket(win: boolean): Ticket {
  return {
    id: "cell-bitmap-chrome",
    no: "",
    balls: Array.from({ length: BALLS_PER_TICKET }, () => 1),
    hits: win ? [0, 1] : [],
    multipliers: {},
    win: "",
  };
}

function sourceTicket(ball: number, hit: boolean, mult: number): Ticket {
  const balls = Array.from({ length: BALLS_PER_TICKET }, () => 1);
  balls[0] = ball;
  return {
    id: "cell-bitmap-src",
    no: "0",
    balls,
    hits: hit ? [0, 1] : [1, 2],
    multipliers: mult > 0 ? { 0: mult } : {},
    win: "$0.00",
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

    return { numbers, dab, multipliers };
  } finally {
    card.dom.remove();
  }
}
