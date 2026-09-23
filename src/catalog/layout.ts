/** Shared catalog constants (non-size). Size tokens live in ticketPresets + catalogLayout. */

/** Live DOM cards in the near-viewport pool. */
export const DOM_POOL_SIZE = 80;

/** Hard cap for the catalog add button on `/`. */
export const MAX_TICKETS = 1000;

/** Tickets per canvas tile (100–200 budget). */
export const CANVAS_TILE_TICKETS = 150;

/**
 * Tickets per tile, shrunk at high dpr so a single tile's backing store
 * (cssW × cssH × dpr²) stays bounded now that DPR_CAP is 4. At dpr ≤ 2 we keep
 * the full 150; at dpr 3–4 we drop to 100 so no individual tile canvas gets
 * huge on flagship phones.
 */
export function canvasTileTickets(dpr: number): number {
  return dpr >= 3 ? 100 : CANVAS_TILE_TICKETS;
}

export const CATALOG_VIEWPORT_HEIGHT = 200;

/** DOM near-viewport row buffer. */
export const ROW_BUFFER = 2;

/** Throttle DOM rebind/translate while scrolling (ms). Canvas is always fully painted. */
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
