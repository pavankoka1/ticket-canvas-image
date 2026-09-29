/**
 * Whole-ticket canvas paint via SVG foreignObject raster (same path as /compare).
 * RAM cache keyed by layout + DPR + ticket content; no layered sprites.
 */

import { activeDpr, applyCellBoxCssVars } from "./cellBoxModel";
import { resolveLiveCellBoxModel } from "./cellAtlas";
import { getActiveLayout, type CatalogLayout } from "./catalogLayout";
import { ticketContentKey } from "./ticketCardElement";
import { clearSvgRasterInkShiftCache, rasterizeTicketSvg } from "./ticketSvgRaster";
import { ensureTicketFontsForLayout } from "./ticketFont";
import { applyTicketCssVars } from "./ticketPresets";
import type { Ticket } from "./tickets";
import { TicketCard } from "./ticketCardElement";

const MAX_CACHE = 256;
const cache = new Map<string, HTMLCanvasElement>();
const cacheOrder: string[] = [];

let captureHost: HTMLElement | null = null;
let captureCard: TicketCard | null = null;

function cacheKey(ticket: Ticket, layout: CatalogLayout, dpr: number): string {
  return `${layout.metrics.id}|${layout.cardWidth}|${layout.cardHeight}|d${dpr}|${ticketContentKey(ticket)}|${ticket.id}`;
}

function remember(key: string, canvas: HTMLCanvasElement): void {
  if (cache.has(key)) {
    const i = cacheOrder.indexOf(key);
    if (i >= 0) cacheOrder.splice(i, 1);
  }
  cache.set(key, canvas);
  cacheOrder.push(key);
  while (cacheOrder.length > MAX_CACHE) {
    const old = cacheOrder.shift();
    if (old) cache.delete(old);
  }
}

function ensureCaptureCard(layout: CatalogLayout): TicketCard {
  if (!captureHost) {
    captureHost = document.createElement("div");
    captureHost.className = "catalog__captureHost";
    captureHost.setAttribute("aria-hidden", "true");
    document.body.appendChild(captureHost);
  }
  const dpr = activeDpr();
  const model = resolveLiveCellBoxModel(layout, dpr);
  applyTicketCssVars(captureHost, layout.metrics);
  applyCellBoxCssVars(captureHost, model, layout.metrics);
  if (!captureCard) {
    captureCard = new TicketCard();
    captureHost.appendChild(captureCard.dom);
  }
  captureCard.applyCardLayout(layout, true);
  captureCard.dom.style.visibility = "visible";
  return captureCard;
}

export function clearTicketRasterCache(): void {
  cache.clear();
  cacheOrder.length = 0;
  clearSvgRasterInkShiftCache();
}

/** Rasterize one ticket at active DPR; returns a device-pixel canvas sized to the card. */
export async function rasterizeTicketBitmap(
  ticket: Ticket,
  layout: CatalogLayout = getActiveLayout(),
): Promise<HTMLCanvasElement> {
  const dpr = activeDpr();
  const key = cacheKey(ticket, layout, dpr);
  const hit = cache.get(key);
  if (hit) return hit;

  await ensureTicketFontsForLayout(layout.metrics);
  const card = ensureCaptureCard(layout);
  card.bind(ticket, 0, 0, layout);
  void card.dom.offsetWidth;
  const canvas = await rasterizeTicketSvg(card.dom, dpr, 0, layout.metrics);
  remember(key, canvas);
  return canvas;
}
