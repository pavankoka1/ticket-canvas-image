/**
 * Header text for the catalog canvas.
 *
 * Ticket ids and win amounts are whole-string bitmaps (same shrink-wrapped
 * foreignObject capture as the live `.ticketCard__id` / `__win` nodes).
 * Per-digit stacking drifts spacing and weight vs one DOM text run.
 */

import { activeDpr } from "./cellBoxModel";
import { getActiveLayout } from "./catalogLayout";
import { rasterizeTicketSvg } from "./ticketSvgRaster";
import { TicketCard } from "./ticketCardElement";
import { ensureTicketFont } from "./ticketFont";
import { isWinTicket, type Ticket } from "./tickets";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export type IdColor = "idNormal" | "idGold" | "idDisabled";

const idStrings = new Map<string, HTMLCanvasElement>();
const amounts = new Map<string, HTMLCanvasElement>();
let digitPromise: Promise<void> | null = null;
let digitKey = "";

function styleKey(): string {
  const layout = getActiveLayout();
  const m = layout.metrics;
  return `${m.id}|${layout.cardWidth}|${activeDpr()}|meta=${m.metaFontSize}`;
}

function idStringCacheKey(color: IdColor, text: string): string {
  return `${styleKey()}|${color}|${text}`;
}

function amountCacheKey(text: string): string {
  return `${styleKey()}|win|${text}`;
}

function shrinkToInk(el: HTMLElement): void {
  el.style.flex = "none";
  el.style.width = "auto";
  el.style.height = "auto";
  el.style.display = "inline-flex";
  el.style.margin = "0";
  el.style.position = "static";
  el.style.whiteSpace = "nowrap";
}

function setElementText(el: HTMLElement, text: string): void {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      (node as Text).data = text;
      return;
    }
  }
}

function blankTicket(no: string, win: boolean, amount: string, disabled = false): Ticket {
  return {
    id: "header-glyph-src",
    no,
    balls: [1, 1, 1, 1, 1, 1],
    hits: win ? [0, 1] : [],
    multipliers: {},
    win: amount,
    disabled,
  };
}

async function withCard(
  host: HTMLElement,
  run: (card: TicketCard) => Promise<void>,
): Promise<void> {
  const card = new TicketCard();
  card.dom.style.position = "fixed";
  card.dom.style.left = "-10000px";
  card.dom.style.top = "0";
  host.appendChild(card.dom);
  try {
    await run(card);
  } finally {
    card.dom.remove();
  }
}

const ID_FACES: readonly { color: IdColor; win: boolean; disabled: boolean }[] = [
  { color: "idNormal", win: false, disabled: false },
  { color: "idGold", win: true, disabled: false },
  { color: "idDisabled", win: false, disabled: true },
];

/** Ten digits in the plain, gold, and green-ticket colors. Idempotent per layout and pixel ratio. */
export function warmIdDigits(host: HTMLElement): Promise<void> {
  const key = styleKey();
  if (digitKey === key && idSeedsReady(key)) return Promise.resolve();
  if (digitPromise && digitKey === key) return digitPromise;
  digitKey = key;
  idStrings.clear();
  const run = captureIdSeeds(host, key).finally(() => {
    if (digitPromise === run) digitPromise = null;
  });
  digitPromise = run;
  return run;
}

function idSeedsReady(key: string): boolean {
  return ID_FACES.every((face) => idStrings.has(`${key}|${face.color}|0`));
}

/** Seed 0–9 per id color (layout / dpr change). */
async function captureIdSeeds(host: HTMLElement, key: string): Promise<void> {
  await ensureTicketFont(getActiveLayout().metrics.metaFontSize);
  const dpr = activeDpr();
  await withCard(host, async (card) => {
    const idEl = card.dom.querySelector(".ticketCard__id");
    if (!(idEl instanceof HTMLElement)) throw new Error("id glyph source missing");
    for (const face of ID_FACES) {
      for (const ch of DIGITS) {
        const cacheId = `${key}|${face.color}|${ch}`;
        if (idStrings.has(cacheId)) continue;
        card.bind(blankTicket(ch, face.win, "", face.disabled));
        shrinkToInk(idEl);
        setElementText(idEl, ch);
        idStrings.set(cacheId, await rasterizeTicketSvg(idEl, dpr));
      }
    }
  });
}

/** Whole ticket numbers — same capture path as win amounts (correct spacing). */
export async function warmTicketIds(
  host: HTMLElement,
  tickets: readonly Ticket[],
): Promise<void> {
  const key = styleKey();
  const missing = tickets.filter((t) => {
    if (!t.no) return false;
    const color: IdColor = t.disabled
      ? "idDisabled"
      : isWinTicket(t)
        ? "idGold"
        : "idNormal";
    return !idStrings.has(idStringCacheKey(color, t.no));
  });
  if (missing.length === 0) return;
  await ensureTicketFont(getActiveLayout().metrics.metaFontSize);
  const dpr = activeDpr();
  const seen = new Set<string>();
  await withCard(host, async (card) => {
    const idEl = card.dom.querySelector(".ticketCard__id");
    if (!(idEl instanceof HTMLElement)) throw new Error("id glyph source missing");
    for (const ticket of missing) {
      const color: IdColor = ticket.disabled
        ? "idDisabled"
        : isWinTicket(ticket)
          ? "idGold"
          : "idNormal";
      const dedupe = `${color}|${ticket.no}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const cacheId = `${key}|${color}|${ticket.no}`;
      if (idStrings.has(cacheId)) continue;
      card.bind(ticket);
      shrinkToInk(idEl);
      setElementText(idEl, ticket.no);
      idStrings.set(cacheId, await rasterizeTicketSvg(idEl, dpr));
    }
  });
}

/** Capture any win-amount string that is not already stored. */
export async function warmAmounts(
  host: HTMLElement,
  texts: readonly string[],
): Promise<void> {
  const missing = [...new Set(texts.filter((t) => t && !amounts.has(amountCacheKey(t))))];
  if (!missing.length) return;
  await ensureTicketFont(getActiveLayout().metrics.metaFontSize);
  const dpr = activeDpr();
  await withCard(host, async (card) => {
    const winEl = card.dom.querySelector(".ticketCard__win");
    if (!(winEl instanceof HTMLElement)) throw new Error("amount source missing");
    for (const text of missing) {
      const cacheId = amountCacheKey(text);
      if (amounts.has(cacheId)) continue;
      card.bind(blankTicket("1", true, text));
      shrinkToInk(winEl);
      setElementText(winEl, text);
      amounts.set(cacheId, await rasterizeTicketSvg(winEl, dpr));
    }
  });
}

export function idDigitCount(): number {
  const prefix = `${styleKey()}|`;
  let n = 0;
  for (const k of idStrings.keys()) {
    if (k.startsWith(prefix)) n += 1;
  }
  return n;
}

/** Right-aligned id, bottom of the header. Missing digits are skipped. */
export function paintIdDigits(
  ctx: CanvasRenderingContext2D,
  text: string,
  color: IdColor,
  originX: number,
  originY: number,
  cardWidth: number,
  dpr: number,
): void {
  const m = getActiveLayout().metrics;
  const bottom = originY + Math.round(m.headerHeight * dpr);
  const right = originX + Math.round(cardWidth * dpr) - Math.round(m.headerPadX * dpr);
  const whole = idStrings.get(idStringCacheKey(color, text));
  if (whole) {
    ctx.drawImage(whole, right - whole.width, bottom - whole.height);
    return;
  }
  // Seed glyphs (single digits) until warmTicketIds catches up for this no.
  let x = right;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i] ?? "";
    const canvas = idStrings.get(idStringCacheKey(color, ch));
    if (!canvas) continue;
    x -= canvas.width;
    ctx.drawImage(canvas, x, bottom - canvas.height);
  }
}

/** Left-aligned amount, bottom of the header. */
export function paintAmount(
  ctx: CanvasRenderingContext2D,
  text: string,
  originX: number,
  originY: number,
  dpr: number,
): void {
  const canvas = amounts.get(amountCacheKey(text));
  if (!canvas) return;
  const m = getActiveLayout().metrics;
  const x = originX + Math.round(m.headerPadX * dpr);
  const bottom = originY + Math.round(m.headerHeight * dpr);
  ctx.drawImage(canvas, x, bottom - canvas.height);
}

