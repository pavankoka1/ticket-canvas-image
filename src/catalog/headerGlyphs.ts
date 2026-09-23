/**
 * Header text for the catalog canvas.
 *
 * Ticket ids are ten digit bitmaps, stacked from the right padding edge.
 * Win amounts are a handful of whole-string bitmaps, captured when the
 * string first appears and shared by every ticket that shows it.
 * Both rasters are the live header element (foreignObject), shrink-wrapped
 * to the glyphs, in Onest 700 at the header size and color.
 */

import { activeDpr } from "./cellBoxModel";
import { getActiveLayout } from "./catalogLayout";
import { rasterizeTicketSvg } from "./ticketSvgRaster";
import { TicketCard } from "./ticketCardElement";
import { ensureTicketFont } from "./ticketFont";
import { type Ticket } from "./tickets";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export type IdColor = "idNormal" | "idGold";

type Glyph = { canvas: HTMLCanvasElement };

const digits = new Map<string, Glyph>();
const amounts = new Map<string, HTMLCanvasElement>();
let digitPromise: Promise<void> | null = null;
let digitKey = "";

function styleKey(): string {
  const layout = getActiveLayout();
  const m = layout.metrics;
  return `${m.id}|${layout.cardWidth}|${activeDpr()}|meta=${m.metaFontSize}`;
}

function digitCacheKey(color: IdColor, ch: string): string {
  return `${styleKey()}|${color}|${ch}`;
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

function blankTicket(no: string, win: boolean, amount: string): Ticket {
  return {
    id: "header-glyph-src",
    no,
    balls: [1, 1, 1, 1, 1, 1],
    hits: win ? [0, 1] : [],
    multipliers: {},
    win: amount,
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

/** Ten digits in both id colors. Idempotent per layout and pixel ratio. */
export function warmIdDigits(host: HTMLElement): Promise<void> {
  const key = styleKey();
  if (digitKey === key && digitsHave(key)) return Promise.resolve();
  if (digitPromise && digitKey === key) return digitPromise;
  digitKey = key;
  const run = captureDigits(host, key).finally(() => {
    if (digitPromise === run) digitPromise = null;
  });
  digitPromise = run;
  return run;
}

function digitsHave(key: string): boolean {
  return digits.has(`${key}|idNormal|0`) && digits.has(`${key}|idGold|0`);
}

async function captureDigits(host: HTMLElement, key: string): Promise<void> {
  await ensureTicketFont(getActiveLayout().metrics.metaFontSize);
  const dpr = activeDpr();
  await withCard(host, async (card) => {
    const idEl = card.dom.querySelector(".ticketCard__id");
    if (!(idEl instanceof HTMLElement)) throw new Error("id glyph source missing");
    for (const gold of [false, true]) {
      const color: IdColor = gold ? "idGold" : "idNormal";
      for (const ch of DIGITS) {
        const cacheId = `${key}|${color}|${ch}`;
        if (digits.has(cacheId)) continue;
        card.bind(blankTicket(ch, gold, ""));
        shrinkToInk(idEl);
        setElementText(idEl, ch);
        const canvas = await rasterizeTicketSvg(idEl, dpr);
        digits.set(cacheId, { canvas });
      }
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
  const key = styleKey();
  let n = 0;
  for (const ch of DIGITS) {
    if (digits.has(`${key}|idNormal|${ch}`)) n += 1;
    if (digits.has(`${key}|idGold|${ch}`)) n += 1;
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
  let x = originX + Math.round(cardWidth * dpr) - Math.round(m.headerPadX * dpr);
  for (let i = text.length - 1; i >= 0; i--) {
    const glyph = digits.get(digitCacheKey(color, text[i] ?? ""));
    if (!glyph) continue;
    const { canvas } = glyph;
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

