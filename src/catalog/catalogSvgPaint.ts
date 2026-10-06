/**
 * Catalog canvas paint via compare svg-all atlas (shared warm pack + DOM overlay text).
 */

import { activeDpr, applyCellBoxCssVars, resolveCellBoxModel } from "./cellBoxModel";
import type { CatalogLayout } from "./catalogLayout";
import { getActiveLayout } from "./catalogLayout";
import { applyTicketCssVars } from "./ticketPresets";
import {
  type ComparePaintPack,
  prepareCompareCard,
  warmCatalogCompareAtlas,
} from "./compareCachedSprites";
import { refreshSvgOverlayInk, SVG_FACE_CLASS } from "./compareSvgText";
import { setCompareRenderMode } from "./compareRenderMode";
import { paintSvgAllCompareTicket } from "./compareSvgAllPaint";
import { loadSvgMultiplierAssets } from "./compareSvgMultiplier";
import { measureHeaderGlyphDeviceXs, stampHeaderGlyphsAtDeviceX } from "./compareGlyphAtlas";
import { styleCompareTicketDom } from "./compareDomAlign";
import { TicketCard } from "./ticketCardElement";
import { MAX_TICKETS } from "./layout";
import { isWinTicket, type Ticket } from "./tickets";
import { paintCatalogTicket } from "./catalogPaint";

let paintPack: ComparePaintPack | null = null;
let measureCard: TicketCard | null = null;
let measureHost: HTMLElement | null = null;
let measureCardPrepared = false;
let measureLayoutKey = "";

type HeaderDeviceLayout = { id: number[]; amt: number[] };
const headerDeviceLayoutCache = new Map<string, HeaderDeviceLayout>();

function headerLayoutCacheKey(
  layout: CatalogLayout,
  face: string,
  ticketNo: string,
  win: string,
): string {
  return `${layout.metrics.id}|${layout.cardWidth}|${face}|${ticketNo}|${win}`;
}

function resetHeaderMeasureState(): void {
  headerDeviceLayoutCache.clear();
  measureCardPrepared = false;
  measureLayoutKey = "";
}

function ensureMeasureCardHost(layout: CatalogLayout): TicketCard {
  if (!measureHost) {
    measureHost = document.createElement("div");
    measureHost.style.cssText =
      "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none";
    measureHost.setAttribute("aria-hidden", "true");
    document.body.append(measureHost);
  }
  if (!measureCard) {
    measureCard = new TicketCard();
    styleCompareTicketDom(measureCard.dom);
    measureHost.append(measureCard.dom);
  }
  const dpr = activeDpr();
  const model = resolveCellBoxModel(layout, dpr);
  applyTicketCssVars(measureHost, layout.metrics);
  applyCellBoxCssVars(measureHost, model, layout.metrics);
  measureHost.style.width = `${layout.cardWidth}px`;
  measureHost.style.height = `${layout.cardHeight}px`;
  return measureCard;
}

export function isCatalogSvgPaintReady(): boolean {
  return Boolean(paintPack?.headerGlyphs && paintPack.catalogChrome.size >= 3);
}

export async function ensureCatalogSvgAtlasWarm(
  layout: CatalogLayout,
): Promise<void> {
  setCompareRenderMode("svg-all");
  await loadSvgMultiplierAssets();
  const dpr = activeDpr();
  paintPack = await warmCatalogCompareAtlas(layout, dpr);
  resetHeaderMeasureState();
  ensureMeasureCardHost(layout);
  await warmCatalogHeaderDeviceLayouts(layout, dpr, MAX_TICKETS);
}

function ensureMeasureCardPrepared(layout: CatalogLayout, dpr: number): TicketCard {
  const card = ensureMeasureCardHost(layout);
  const key = `${layout.metrics.id}|${layout.cardWidth}`;
  if (measureCardPrepared && measureLayoutKey === key) return card;
  card.dom.classList.add("ticketCard_compare", SVG_FACE_CLASS);
  prepareCompareCard(card, layout, dpr);
  measureCardPrepared = true;
  measureLayoutKey = key;
  return card;
}

function measureHeaderDeviceLayout(
  ticket: Ticket,
  layout: CatalogLayout,
  face: "normal" | "gold" | "disabled",
  dpr: number,
): HeaderDeviceLayout {
  const winText = isWinTicket(ticket) && ticket.win ? ticket.win : "";
  const cacheKey = headerLayoutCacheKey(layout, face, ticket.no, winText);
  const cached = headerDeviceLayoutCache.get(cacheKey);
  if (cached) return cached;

  const card = ensureMeasureCardPrepared(layout, dpr);
  card.bind(ticket, 0, 0, layout);
  refreshSvgOverlayInk(card.dom);
  const layoutEntry = measureHeaderGlyphDeviceXs(card.dom, ticket.no, winText, dpr);
  headerDeviceLayoutCache.set(cacheKey, layoutEntry);
  return layoutEntry;
}

const WARM_HEADER_BATCH = 40;

function yieldWarm(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } })
    .scheduler;
  if (sched?.yield) return sched.yield();
  return new Promise((r) => setTimeout(r, 0));
}

/** Pre-measure header glyph X for catalog ticket numbers (paint path stays DOM-free). */
async function warmCatalogHeaderDeviceLayouts(
  layout: CatalogLayout,
  dpr: number,
  maxNo: number,
): Promise<void> {
  ensureMeasureCardPrepared(layout, dpr);
  const balls = [1, 2, 3, 4, 5, 6] as const;
  for (let n = 1; n <= maxNo; n++) {
    const no = String(n);
    const ticket: Ticket = {
      id: `warm-${n}`,
      no,
      balls: [...balls],
      hits: [],
      multipliers: {},
      win: "",
    };
    measureHeaderDeviceLayout(ticket, layout, "normal", dpr);
    if (n % WARM_HEADER_BATCH === 0) await yieldWarm();
  }
}

export function prepareCatalogDomCard(card: TicketCard): void {
  if (!isCatalogSvgPaintReady()) return;
  const layout = getActiveLayout();
  card.dom.classList.add(SVG_FACE_CLASS);
  prepareCompareCard(card, layout, activeDpr());
}

/** Paint one catalog tile ticket with the compare svg-all sprite stack. */
export function paintCatalogTicketSvgAll(
  ctx: CanvasRenderingContext2D,
  ticket: Ticket,
  originX: number,
  originY: number,
  layout: CatalogLayout,
  dpr: number,
): void {
  const pack = paintPack;
  if (!pack?.headerGlyphs || pack.catalogChrome.size < 3) {
    const boxes = resolveCellBoxModel(layout, dpr).cells;
    paintCatalogTicket(ctx, ticket, originX, originY, layout.cardWidth, dpr, boxes);
    return;
  }

  const model = resolveCellBoxModel(layout, dpr);
  const face = ticket.disabled ? "disabled" : isWinTicket(ticket) ? "gold" : "normal";
  const chrome = pack.catalogChrome.get(face);
  if (!chrome) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(chrome.bitmap, originX, originY);

  paintSvgAllCompareTicket(
    ctx,
    ticket,
    pack,
    layout,
    model.cells.map((c) => c.x),
    model.cellW,
    face,
    originX,
    originY,
    dpr,
    "badge-host",
    model.cells,
  );

  const winText = isWinTicket(ticket) && ticket.win ? ticket.win : "";
  const headerLayout = measureHeaderDeviceLayout(ticket, layout, face, dpr);
  stampHeaderGlyphsAtDeviceX(
    ctx,
    ticket.no,
    winText,
    face,
    dpr,
    pack.headerGlyphs,
    originX,
    originY,
    headerLayout.id,
    headerLayout.amt,
  );
}
