/** Shared catalog constants (non-size). Size tokens live in ticketPresets + catalogLayout. */

/** Live DOM cards in the near-viewport pool (desktop). */
export const DOM_POOL_SIZE = 80;

/** Live DOM cards on mobile — fewer compositor layers; canvas covers the rest. */
export const DOM_POOL_SIZE_MOBILE = 28;

/** Hard cap for the catalog add button on `/`. */
export const MAX_TICKETS = 1000;

/** Tickets per canvas tile (100–200 budget). */
export const CANVAS_TILE_TICKETS = 150;

/** Pool size for the live DOM band. */
export function domPoolSize(isMobile: boolean): number {
  return isMobile ? DOM_POOL_SIZE_MOBILE : DOM_POOL_SIZE;
}

/**
 * Tickets per tile. Shrink at high dpr so backing-store bytes stay bounded
 * (DPR_CAP is 4). Also shrink when `navigator.deviceMemory` reports ≤2GB —
 * that signal is Chrome/Android only; missing → keep the dpr-based default.
 *
 * At dpr 3 a 100-ticket tile is ~27MB, and one tile is also the unit a scroll
 * has to repaint before it can be shown. Smaller tiles keep both numbers down.
 */
export function canvasTileTickets(dpr: number): number {
  let n = dpr >= 3 ? 40 : CANVAS_TILE_TICKETS;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (mem != null && mem <= 2) n = Math.min(n, 40);
  return n;
}

/**
 * Ceiling on live tile backing stores. Tiles cover the whole catalog, so holding
 * every one costs 27MB per 100 tickets at dpr 3 — 274MB at MAX_TICKETS, which is
 * past what iOS Safari grants a page. Over the budget WebKit discards backing
 * stores and the canvas underlay goes blank, so the pool keeps only the tiles
 * near the scrollport and repaints the others as they come back into view.
 */
export const CANVAS_TILE_RETAIN_BYTES = 48 * 1024 * 1024;

/** DOM near-viewport row buffer. */
export const ROW_BUFFER = 2;

/**
 * Evicted pool cards park off-screen (not `opacity:0` — WebKit still composites
 * them above the canvas layer and hides the tile underlay on `/`).
 */
export const POOL_OFFSCREEN_PX = 10_000;

/**
 * After scroll stops (`scrollend` or legacy debounce), wait this long with a
 * stable scrollTop before repartitioning the DOM band / canvas skip set.
 * Separate from SETTLE_MS (resize canvas rebuild).
 */
export const SCROLL_BAND_SETTLE_MS = 300;

/** Unused by the live band. Visible rows stay DOM while scrolling. */
export const DOM_SCROLL_THROTTLE_MS = 300;

export const BALLS_PER_TICKET = 6;

/** Legacy bake-path stubs (unused by cell-atlas flow). */
export const CARD_WIDTH = 197;
export const CARD_HEIGHT = 43;

/** @deprecated Prefer getActiveLayout() — kept for call-site migration. */
export {
  contentHeight,
  contentWidth,
  getActiveLayout,
  rowHeight,
  setActiveLayout,
} from './layout/catalogLayout';
