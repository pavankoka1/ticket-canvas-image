/** Desktop medium footprint — matches moneyball `desktopMedium` / TicketCard.module.css. */

export const COLUMNS = 5;
export const CARD_WIDTH = 197;
export const CARD_HEIGHT = 43;
export const CARD_RADIUS = 5;
export const COLUMN_GAP = 4;
export const ROW_GAP = 4;

/**
 * Viewport DOM pool only (~moneyball sticky overlay ~80).
 * Catalog size must NEVER grow this — that was the 20–30k node trap.
 */
export const DOM_POOL_SIZE = 48;

/**
 * Max tickets drawn on the single canvas underlay (not DOM nodes).
 * One `<canvas>` element total — not one canvas per ticket.
 */
export const CANVAS_BAND_CAPACITY = 400;

/**
 * Moneyball catalog is parent-sized; the game grid pane is typically ~300–400px tall.
 * Lock the POC scroller to that so scroll behaviour matches the product.
 */
export const CATALOG_VIEWPORT_HEIGHT = 200;

export const ROW_BUFFER = 1;
export const BALLS_PER_TICKET = 6;

export function rowHeight(): number {
  return CARD_HEIGHT + ROW_GAP;
}

export function contentWidth(): number {
  return COLUMNS * CARD_WIDTH + (COLUMNS - 1) * COLUMN_GAP;
}

export function contentHeight(ticketCount: number): number {
  const rows = Math.ceil(ticketCount / COLUMNS);
  if (rows === 0) return 0;
  return rows * CARD_HEIGHT + (rows - 1) * ROW_GAP;
}
