/** Shared catalog constants (non-size). Size tokens live in ticketPresets + catalogLayout. */

/** Live DOM cards in the near-viewport pool (desktop). */
export const DOM_POOL_SIZE = 80;

/** Live DOM cards on mobile — fewer compositor layers; canvas covers the rest. */
export const DOM_POOL_SIZE_MOBILE = 40;

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
 */
export function canvasTileTickets(dpr: number): number {
  let n = dpr >= 3 ? 100 : CANVAS_TILE_TICKETS;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (mem != null && mem <= 2) n = Math.min(n, 80);
  return n;
}

/** DOM near-viewport row buffer. */
export const ROW_BUFFER = 2;

/**
 * After scroll stops, wait this long before repartitioning the DOM band /
 * canvas skip set. Separate from SETTLE_MS (resize canvas rebuild).
 */
export const SCROLL_BAND_SETTLE_MS = 150;

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
} from './catalogLayout';
