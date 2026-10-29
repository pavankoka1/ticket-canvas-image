/**
 * Catalog canvas paint via compare svg-all atlas (shared warm pack + DOM overlay text).
 */

import { activeDpr, applyCellBoxCssVars, resolveCellBoxModel } from "../../layout/cellBoxModel";
import {
  catalogLayoutCacheKey,
  getActiveLayout,
  type CatalogLayout,
} from "../../layout/catalogLayout";
import { applyTicketCssVars } from "../../model/ticketPresets";
import {
  type ComparePaintPack,
  prepareCompareCard,
  warmCatalogCompareAtlas,
} from "../../../catalog/compareCachedSprites";
import { refreshSvgOverlayInk, SVG_FACE_CLASS } from "../../../catalog/compareSvgText";
import { setCompareRenderMode } from "../../../catalog/compareRenderMode";
import {
  clipTicketRoundRectDevice,
  isCatalogSvgAllHostInkReady,
  paintSvgAllCatalogTicketInk,
  warmSvgAllHostBadgeBitmaps,
  warmSvgAllMultiplierHosts,
} from "../../../catalog/compareSvgAllPaint";
import { loadSvgMultiplierAssets } from "../../../catalog/compareSvgMultiplier";
import { measureHeaderGlyphDeviceXsBatch, stampHeaderGlyphsAtDeviceX } from "../../../catalog/compareGlyphAtlas";
import { styleCompareTicketDom } from "../../../catalog/compareDomAlign";
import { TicketCard } from "../../dom/ticketCardElement";
import { MAX_TICKETS } from "../../constants";
import { isWinTicket, type Ticket } from "../../model/tickets";
import { paintCatalogTicket } from "./catalogPaint";

let paintPack: ComparePaintPack | null = null;
let paintPackLayoutKey = "";
let measureCard: TicketCard | null = null;
let measureHost: HTMLElement | null = null;
let measureCardPrepared = false;
let measureLayoutKey = "";

type HeaderDeviceLayout = { id: number[]; amt: number[] };
const headerDeviceLayoutCache = new Map<string, HeaderDeviceLayout>();

/** Face only changes fill colours, so it is not part of the key. */
function headerLayoutCacheKey(layout: CatalogLayout, ticketNo: string, win: string): string {
  return `${layout.metrics.id}|${layout.cardWidth}|${ticketNo}|${win}`;
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
  applyTicketCssVars(measureCard.dom, layout.metrics);
  applyCellBoxCssVars(measureCard.dom, model, layout.metrics);
  measureHost.style.width = `${layout.cardWidth}px`;
  measureHost.style.height = `${layout.cardHeight}px`;
  measureCard.applyCardWidth(layout.cardWidth, true);
  return measureCard;
}

function paintPackForLayout(layout: CatalogLayout): ComparePaintPack | null {
  const key = catalogLayoutCacheKey(layout);
  if (!paintPack || paintPackLayoutKey !== key) return null;
  return paintPack;
}

export function isCatalogSvgPaintReady(layout: CatalogLayout = getActiveLayout()): boolean {
  const pack = paintPackForLayout(layout);
  return Boolean(
    pack?.headerGlyphs &&
      pack.catalogChrome.size >= 3 &&
      (pack.badges?.size ?? 0) > 0,
  );
}

/**
 * Pre-warms IDB/RAM caches for `layout` without touching `paintPack`
 * or `headerDeviceLayoutCache`. Use from landscape prewarm only.
 */
export async function warmCatalogAtlasForPrewarm(layout: CatalogLayout): Promise<void> {
  await loadSvgMultiplierAssets();
  const dpr = activeDpr();
  await warmCatalogCompareAtlas(layout, dpr);
}

export async function ensureCatalogSvgAtlasWarm(
  layout: CatalogLayout,
  expectedLayoutKey = catalogLayoutCacheKey(layout),
): Promise<void> {
  setCompareRenderMode("svg-all");
  await loadSvgMultiplierAssets();
  const dpr = activeDpr();
  const pack = await warmCatalogCompareAtlas(layout, dpr);
  if (catalogLayoutCacheKey(getActiveLayout()) !== expectedLayoutKey) {
    console.warn("[catalog-svg-warm] layout changed during warm — keeping prior paint pack");
    return;
  }
  paintPack = pack;
  paintPackLayoutKey = expectedLayoutKey;
  const commitHostInk = () => catalogLayoutCacheKey(layout) === expectedLayoutKey;
  try {
    await warmSvgAllHostBadgeBitmaps(layout, dpr, commitHostInk);
    await warmSvgAllMultiplierHosts(layout, dpr, commitHostInk);
  } catch (err) {
    console.warn("[catalog-svg-warm] host ink optional warm failed; using compare badge atlas", err);
  }
  if (!isCatalogSvgAllHostInkReady()) {
    console.info("[catalog-svg-warm] host ink partial — catalog paint uses compare badge atlas fallback");
  }
  const measureKey = `${layout.metrics.id}|${layout.cardWidth}`;
  if (measureLayoutKey !== measureKey) {
    resetHeaderMeasureState();
  }
  ensureMeasureCardHost(layout);
  await warmCatalogHeaderDeviceLayouts(layout, dpr, MAX_TICKETS);
}

/**
 * Measure card bound once to a winning ticket, so its overlay holds both an id and
 * an amount `<text>` for `measureHeaderGlyphDeviceXsBatch` to clone.
 */
const MEASURE_TICKET: Ticket = {
  id: "catalog-header-measure",
  no: "1",
  balls: [1, 2, 3, 4, 5, 6],
  hits: [0, 1, 2, 3, 4, 5],
  multipliers: {},
  win: "1",
};

function ensureMeasureCardPrepared(layout: CatalogLayout, dpr: number): TicketCard {
  const card = ensureMeasureCardHost(layout);
  const key = `${layout.metrics.id}|${layout.cardWidth}`;
  if (measureCardPrepared && measureLayoutKey === key) return card;
  card.dom.classList.add("ticketCard_compare", SVG_FACE_CLASS);
  prepareCompareCard(card, layout, dpr);
  card.bind(MEASURE_TICKET, 0, 0, layout);
  // Full overlay required — partial header sync mis-measures glyph X (canvas id drift).
  refreshSvgOverlayInk(card.dom);
  measureCardPrepared = true;
  measureLayoutKey = key;
  return card;
}

function measureHeaderDeviceLayouts(
  headers: readonly { no: string; win: string }[],
  layout: CatalogLayout,
  dpr: number,
): void {
  const card = ensureMeasureCardPrepared(layout, dpr);
  const measured = measureHeaderGlyphDeviceXsBatch(card.dom, headers, dpr);
  headers.forEach((h, i) => headerDeviceLayoutCache.set(headerLayoutCacheKey(layout, h.no, h.win), measured[i]!));
}

function measureHeaderDeviceLayout(ticket: Ticket, layout: CatalogLayout, dpr: number): HeaderDeviceLayout {
  const win = isWinTicket(ticket) && ticket.win ? ticket.win : "";
  const cacheKey = headerLayoutCacheKey(layout, ticket.no, win);
  const cached = headerDeviceLayoutCache.get(cacheKey);
  if (cached) return cached;
  measureHeaderDeviceLayouts([{ no: ticket.no, win }], layout, dpr);
  return headerDeviceLayoutCache.get(cacheKey)!;
}

const WARM_HEADER_BATCH = 250;

function yieldWarmIdle(): Promise<void> {
  if (typeof requestIdleCallback === "function") {
    return new Promise((r) => requestIdleCallback(() => r(), { timeout: 200 }));
  }
  return new Promise((r) => setTimeout(r, 0));
}

/** Pre-measure header glyph X for catalog ticket numbers (paint path stays DOM-free). */
async function warmCatalogHeaderDeviceLayouts(
  layout: CatalogLayout,
  dpr: number,
  maxNo: number,
): Promise<void> {
  for (let start = 1; start <= maxNo; start += WARM_HEADER_BATCH) {
    const headers: { no: string; win: string }[] = [];
    for (let n = start; n < start + WARM_HEADER_BATCH && n <= maxNo; n++) headers.push({ no: String(n), win: "" });
    measureHeaderDeviceLayouts(headers, layout, dpr);
    if (start + WARM_HEADER_BATCH <= maxNo) await yieldWarmIdle();
  }
}

const JIT_WARM_TICKET: Ticket = {
  id: "catalog-svg-jit-warm",
  no: "1",
  balls: [1, 2, 3, 4, 5, 6],
  hits: [],
  multipliers: {},
  win: "",
};

/**
 * One-off paint into a 1×1 canvas so V8 compiles the svg-all path before the
 * first real tile or scroll settle hits `paintCatalogTicketSvgAll`.
 */
export function prewarmCatalogSvgPaintJit(layout: CatalogLayout): void {
  if (!isCatalogSvgPaintReady()) return;
  const scratch = document.createElement("canvas");
  scratch.width = 1;
  scratch.height = 1;
  const ctx = scratch.getContext("2d");
  if (!ctx) return;
  paintCatalogTicketSvgAll(ctx, JIT_WARM_TICKET, 0, 0, layout, activeDpr());
}

export function prepareCatalogDomCard(card: TicketCard): void {
  if (!isCatalogSvgPaintReady(getActiveLayout())) return;
  const layout = getActiveLayout();
  card.dom.classList.add(SVG_FACE_CLASS);
  prepareCompareCard(card, layout, activeDpr());
  refreshSvgOverlayInk(card.dom);
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
  const pack = paintPackForLayout(layout);
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
  const m = layout.metrics;
  ctx.save();
  clipTicketRoundRectDevice(
    ctx,
    originX,
    originY,
    layout.cardWidth,
    m.cardHeight,
    m.radius,
    dpr,
  );
  ctx.drawImage(chrome.bitmap, originX, originY);

  paintSvgAllCatalogTicketInk(
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
    model.cells,
  );
  ctx.restore();

  const winText = isWinTicket(ticket) && ticket.win ? ticket.win : "";
  const headerLayout = measureHeaderDeviceLayout(ticket, layout, dpr);
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
