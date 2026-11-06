/**
 * Catalog canvas paint via compare svg-all atlas (shared warm pack + DOM overlay text).
 */

import { MAX_TICKETS } from "../../constants";
import { TicketCard } from "../../dom/ticketCardElement";
import {
  catalogLayoutCacheKey,
  getActiveLayout,
  type CatalogLayout,
} from "../../layout/catalogLayout";
import { activeDpr, applyCellBoxCssVars, resolveCellBoxModel } from "../../layout/cellBoxModel";
import { applyTicketCssVars } from "../../model/ticketPresets";
import { isWinTicket, ticketFace, ticketHasBadgeInk, type Ticket } from "../../model/tickets";
import { styleCompareTicketDom } from "../../../catalog/compareDomAlign";
import { measureHeaderGlyphDeviceXsBatch, stampHeaderGlyphsAtDeviceX } from "../../../catalog/compareGlyphAtlas";
import { setCompareRenderMode } from "../../../catalog/compareRenderMode";
import {
  type ComparePaintPack,
  prepareCompareCard,
  warmCatalogCompareAtlas,
} from "../../../catalog/compareCachedSprites";
import {
  applySvgText,
  patchSvgOverlayInkFromDom,
  refreshSvgOverlayInk,
  SVG_FACE_CLASS,
  SVG_SEPS_CLASS,
} from "../../../catalog/compareSvgText";
import { paintTicketSeparatorsDevice } from "../../svg/ticketSvgChrome";
import { loadSvgMultiplierAssets } from "../../../catalog/compareSvgMultiplier";
import {
  blitCatalogChromeBitmap,
  clipTicketRoundRectDevice,
  invalidateMultHostWarmCache,
  isCatalogSvgAllHostInkReady,
  paintSvgAllCatalogTicketInk,
  paintSvgAllCompareTicket,
  warmSvgAllHostBadgeBitmaps,
  warmSvgAllMultiplierHosts,
  type SvgAllPaintContext,
} from "../../../catalog/compareSvgAllPaint";

let paintPack: ComparePaintPack | null = null;
let paintPackLayoutKey = '';

/** Cleared before compare re-warm so paint does not keep a stale in-memory pack. */
export function invalidateCatalogPaintPack(): void {
  paintPack = null;
  paintPackLayoutKey = '';
}
let measureCard: TicketCard | null = null;
let measureHost: HTMLElement | null = null;
let measureCardPrepared = false;
let measureLayoutKey = '';

type HeaderDeviceLayout = { id: number[]; amt: number[] };
const headerDeviceLayoutCache = new Map<string, HeaderDeviceLayout>();

/** Face only changes fill colours, so it is not part of the key. */
function headerLayoutCacheKey(layout: CatalogLayout, ticketNo: string, win: string): string {
  return `${layout.metrics.id}|${layout.cardWidth}|${ticketNo}|${win}`;
}

function resetHeaderMeasureState(): void {
  headerDeviceLayoutCache.clear();
  measureCardPrepared = false;
  measureLayoutKey = '';
}

function ensureMeasureCardHost(layout: CatalogLayout): TicketCard {
  if (!measureHost) {
    measureHost = document.createElement('div');
    measureHost.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';
    measureHost.setAttribute('aria-hidden', 'true');
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

/**
 * True once any layout has warmed. From then on the DOM band paints svg-all faces,
 * so the legacy sprite blit would mix two separator recipes on screen.
 */
export function hasCatalogSvgPaintPack(): boolean {
  return paintPack !== null;
}

export function isCatalogSvgPaintReady(layout: CatalogLayout = getActiveLayout()): boolean {
  const pack = paintPackForLayout(layout);
  return Boolean(pack?.headerGlyphs && pack.catalogChrome.size >= 3 && (pack.badges?.size ?? 0) > 0);
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
  logPhase?: (label: string) => void
): Promise<void> {
  setCompareRenderMode('svg-all');
  await loadSvgMultiplierAssets();
  const dpr = activeDpr();
  const pack = await warmCatalogCompareAtlas(layout, dpr, logPhase);
  if (catalogLayoutCacheKey(getActiveLayout()) !== expectedLayoutKey) {
    console.warn('[catalog-svg-warm] layout changed during warm — keeping prior paint pack');
    return;
  }
  paintPack = pack;
  paintPackLayoutKey = expectedLayoutKey;
  const commitHostInk = (): boolean =>
    catalogLayoutCacheKey(getActiveLayout()) === expectedLayoutKey && activeDpr() === dpr;
  try {
    await warmSvgAllHostBadgeBitmaps(layout, dpr, commitHostInk);
    await warmSvgAllMultiplierHosts(layout, dpr, commitHostInk);
  } catch (err) {
    console.warn('[catalog-svg-warm] host ink optional warm failed; using compare badge atlas', err);
  }
  if (!isCatalogSvgAllHostInkReady(layout, dpr)) {
    console.info('[catalog-svg-warm] host ink partial — catalog paint uses compare badge atlas fallback');
  }
  const measureKey = `${layout.metrics.id}|${layout.cardWidth}`;
  if (measureLayoutKey !== measureKey) {
    resetHeaderMeasureState();
  }
  ensureMeasureCardHost(layout);
  // Only the first screens block the warm. Measuring all MAX_TICKETS headers is
  // ~1000 SVG text clones and CTM reads, it is never served from IDB, and it was
  // the bulk of time-to-first-tile. The rest trickles in while the canvas paints;
  // `measureHeaderDeviceLayout` still covers any ticket the trickle has not reached.
  await warmCatalogHeaderDeviceLayouts(layout, dpr, WARM_HEADER_EAGER, expectedLayoutKey);
  void warmCatalogHeaderDeviceLayouts(layout, dpr, MAX_TICKETS, expectedLayoutKey).catch((err) => {
    console.warn('[catalog-svg-warm] background header measure stopped', err);
  });
}

/** Add badge + host ink for multiplier values discovered after the initial warm. */
export async function patchCatalogMultiplierBadges(values: readonly number[]): Promise<void> {
  const pack = paintPack;
  const layout = getActiveLayout();
  const dpr = activeDpr();
  if (!pack || values.length === 0) return;
  invalidateMultHostWarmCache();
  const commitHostInk = (): boolean => paintPack === pack && activeDpr() === dpr;
  try {
    await warmSvgAllMultiplierHosts(layout, dpr, commitHostInk);
  } catch {
    // compare badge atlas still paints mult discs without host labels
  }
}

/**
 * Measure card bound once to a winning ticket, so its overlay holds both an id and
 * an amount `<text>` for `measureHeaderGlyphDeviceXsBatch` to clone.
 */
const MEASURE_TICKET: Ticket = {
  id: 'catalog-header-measure',
  no: '1',
  balls: [1, 2, 3, 4, 5, 6],
  hits: [0, 1, 2, 3, 4, 5],
  multipliers: {},
  win: '1',
};

function ensureMeasureCardPrepared(layout: CatalogLayout, dpr: number): TicketCard {
  const card = ensureMeasureCardHost(layout);
  const key = `${layout.metrics.id}|${layout.cardWidth}`;
  if (measureCardPrepared && measureLayoutKey === key) return card;
  card.dom.classList.add('ticketCard_compare', SVG_FACE_CLASS);
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
  dpr: number
): void {
  const card = ensureMeasureCardPrepared(layout, dpr);
  const measured = measureHeaderGlyphDeviceXsBatch(card.dom, headers, dpr);
  headers.forEach((h, i) => headerDeviceLayoutCache.set(headerLayoutCacheKey(layout, h.no, h.win), measured[i]!));
}

function measureHeaderDeviceLayout(ticket: Ticket, layout: CatalogLayout, dpr: number): HeaderDeviceLayout {
  const win = isWinTicket(ticket) && ticket.win ? ticket.win : '';
  const cacheKey = headerLayoutCacheKey(layout, ticket.no, win);
  const cached = headerDeviceLayoutCache.get(cacheKey);
  if (cached) return cached;
  measureHeaderDeviceLayouts([{ no: ticket.no, win }], layout, dpr);
  return headerDeviceLayoutCache.get(cacheKey)!;
}

const WARM_HEADER_BATCH = 250;

/** Headers measured before first paint — about one viewport of tickets. */
const WARM_HEADER_EAGER = 15;

function yieldWarmIdle(): Promise<void> {
  if (typeof requestIdleCallback === 'function') {
    return new Promise((r) => requestIdleCallback(() => r(), { timeout: 200 }));
  }
  return new Promise((r) => setTimeout(r, 0));
}

/** Pre-measure header glyph X for catalog ticket numbers (paint path stays DOM-free). */
async function warmCatalogHeaderDeviceLayouts(
  layout: CatalogLayout,
  dpr: number,
  maxNo: number,
  expectedLayoutKey = catalogLayoutCacheKey(layout)
): Promise<void> {
  for (let start = 1; start <= maxNo; start += WARM_HEADER_BATCH) {
    if (catalogLayoutCacheKey(getActiveLayout()) !== expectedLayoutKey) return;
    const headers: { no: string; win: string }[] = [];
    for (let n = start; n < start + WARM_HEADER_BATCH && n <= maxNo; n++) {
      const no = String(n);
      if (headerDeviceLayoutCache.has(headerLayoutCacheKey(layout, no, ''))) continue;
      headers.push({ no, win: '' });
    }
    if (headers.length > 0) measureHeaderDeviceLayouts(headers, layout, dpr);
    if (start + WARM_HEADER_BATCH <= maxNo) await yieldWarmIdle();
  }
}

const JIT_WARM_TICKET: Ticket = {
  id: 'catalog-svg-jit-warm',
  no: '1',
  balls: [1, 2, 3, 4, 5, 6],
  hits: [],
  multipliers: {},
  win: '',
};

/**
 * One-off paint into a 1×1 canvas so V8 compiles the svg-all path before the
 * first real tile or scroll settle hits `paintCatalogTicketSvgAll`.
 */
export function prewarmCatalogSvgPaintJit(layout: CatalogLayout): void {
  if (!isCatalogSvgPaintReady()) return;
  const scratch = document.createElement('canvas');
  scratch.width = 1;
  scratch.height = 1;
  const ctx = scratch.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  paintCatalogTicketSvgAll(ctx, JIT_WARM_TICKET, 0, 0, layout, activeDpr());
}

/** Layout and dpr each pool card's scaffolding was last built for. */
const preparedFor = new WeakMap<HTMLElement, string>();

/**
 * Drop svg-all overlay mode until `ensureCatalogSvgAtlasWarm` commits a pack for
 * the live layout. Without this, cards keep transparent HTML text and no valid
 * overlay after a breakpoint change — the band looks empty even though bind ran.
 */
export function revertCatalogDomCardHtmlFace(card: TicketCard): void {
  if (!card.dom.classList.contains(SVG_FACE_CLASS)) return;
  applySvgText(card.dom, false);
  card.dom.classList.remove(SVG_FACE_CLASS);
  preparedFor.delete(card.dom);
}

/**
 * Full settle revert: drop svg-face overlay and every inline var / badge box
 * from `prepareCompareCard` so pooled cards inherit the catalog root until warm.
 */
export function revertCatalogDomCardForLayoutSettle(card: TicketCard): void {
  applySvgText(card.dom, false);
  card.dom.classList.remove(SVG_FACE_CLASS, SVG_SEPS_CLASS, 'ticketCard_compare');
  preparedFor.delete(card.dom);
  card.releaseComparePrepareInlineState();
}

/** Drop layout scaffolding cache when a pool card leaves the visible band. */
export function clearPreparedCatalogDomCard(card: TicketCard): void {
  preparedFor.delete(card.dom);
}

export function prepareCatalogDomCard(card: TicketCard): void {
  const layout = getActiveLayout();
  if (!isCatalogSvgPaintReady(layout)) return;
  const dpr = activeDpr();
  card.dom.classList.add(SVG_FACE_CLASS);
  // `prepareCompareCard` writes cell geometry, CSS vars and badge-host boxes,
  // none of which depend on the ticket — but it runs for every card the pool
  // rebinds, which is the whole band on a scroll settle or a shuffle. Only the
  // ink below has to be redone each time.
  const key = `${catalogLayoutCacheKey(layout)}|${dpr}`;
  const miss = preparedFor.get(card.dom) !== key;
  if (miss) {
    prepareCompareCard(card, layout, dpr);
    refreshSvgOverlayInk(card.dom);
    preparedFor.set(card.dom, key);
  } else {
    patchSvgOverlayInkFromDom(card.dom, dpr);
  }
}

let paintContext: SvgAllPaintContext | null = null;

/**
 * Sprite pack plus this layout's cell grid, rebuilt only when one of them
 * changes. `resolveCellBoxModel` allocates six cell boxes per call, which is
 * measurable when the tile loop runs it once per ticket.
 */
function catalogPaintContext(pack: ComparePaintPack, layout: CatalogLayout, dpr: number): SvgAllPaintContext {
  if (paintContext?.pack === pack && paintContext.layout === layout && paintContext.dpr === dpr) {
    return paintContext;
  }
  const model = resolveCellBoxModel(layout, dpr);
  paintContext = { pack, layout, dpr, cells: model.cells, cellW: model.cellW };
  return paintContext;
}

/**
 * Paint one catalog tile ticket with the compare svg-all sprite stack.
 *
 * `ctx` must already be in device space — identity transform, smoothing off.
 * `CanvasPool.paintTileSlots` establishes that once for the whole tile range
 * rather than per ticket; `setTransform` is one of the costliest calls here.
 */
export function paintCatalogTicketSvgAll(
  ctx: CanvasRenderingContext2D,
  ticket: Ticket,
  originX: number,
  originY: number,
  layout: CatalogLayout,
  dpr: number
): void {
  ctx.globalCompositeOperation = 'source-over';
  const pack = paintPackForLayout(layout);
  // A pack for another layout paints last layout's separators under this layout's
  // DOM. Callers choose the fallback; painting nothing is better than painting wrong.
  if (!pack?.headerGlyphs || pack.catalogChrome.size < 3) return;

  const face = ticketFace(ticket);
  const chrome = pack.catalogChrome.get(face);
  if (!chrome) return;

  const m = layout.metrics;
  const shellColor =
    face === 'disabled' ? '#0d5b58' : face === 'gold' ? '#ffd65c' : null;
  if (shellColor) {
    ctx.save();
    clipTicketRoundRectDevice(ctx, originX, originY, layout.cardWidth, m.cardHeight, m.radius, dpr);
    ctx.fillStyle = shellColor;
    const wDev = Math.round(layout.cardWidth * dpr);
    const hDev = Math.round(m.cardHeight * dpr);
    ctx.fillRect(originX, originY, wDev, hDev);
    ctx.restore();
  }
  ctx.save();
  clipTicketRoundRectDevice(ctx, originX, originY, layout.cardWidth, m.cardHeight, m.radius, dpr);
  blitCatalogChromeBitmap(ctx, chrome.bitmap, originX, originY, layout.cardWidth, m.cardHeight, dpr);
  ctx.restore();

  const context = catalogPaintContext(pack, layout, dpr);

  // Cell digits sit inside the body band, clear of the corner arcs, so a ticket
  // with no dab or multiplier needs neither the clip nor the save/restore that
  // carries it — that is ten of the twenty-one canvas calls a plain ticket makes.
  if (ticketHasBadgeInk(ticket)) {
    ctx.save();
    clipTicketRoundRectDevice(ctx, originX, originY, layout.cardWidth, m.cardHeight, m.radius, dpr);
    paintSvgAllCatalogTicketInk(ctx, context, ticket, face, originX, originY);
    ctx.restore();
  } else {
    paintSvgAllCompareTicket(ctx, context, ticket, face, originX, originY);
  }

  const winText = isWinTicket(ticket) && ticket.win ? ticket.win : '';
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
    headerLayout.amt
  );

  paintTicketSeparatorsDevice(ctx, originX, originY, layout, m, face, dpr);
}
