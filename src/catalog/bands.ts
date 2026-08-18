import { CANVAS_BAND_CAPACITY, COLUMNS, rowHeight } from './layout';
import type { TicketSlot } from './tickets';

export type CatalogBands = {
  /** Viewport (+ small row buffer) — real DOM on top. */
  dom: TicketSlot[];
  /** Canvas underlay: viewport + ahead/behind scroll path (≤ CANVAS_BAND_CAPACITY). */
  canvas: TicketSlot[];
  above: number;
  below: number;
};

/**
 * DOM owns the viewport. Canvas paints a wide window centered on that band (including the
 * viewport as underlay) so the scroll path is already drawn before you arrive — no seam gaps.
 */
export function computeCatalogBands(
  slots: readonly TicketSlot[],
  scrollTop: number,
  viewportH: number,
  bufferRows: number
): CatalogBands {
  if (slots.length === 0) {
    return { dom: [], canvas: [], above: 0, below: 0 };
  }

  const rh = rowHeight();
  const viewH = Math.max(viewportH, rh);
  const top = Math.max(0, scrollTop - bufferRows * rh);
  const bottom = scrollTop + viewH + bufferRows * rh;
  const startRow = Math.floor(top / rh);
  const endRow = Math.ceil(bottom / rh);
  let domStart = Math.max(0, startRow * COLUMNS);
  let domEnd = Math.min(slots.length, endRow * COLUMNS);
  if (domStart >= domEnd) {
    domStart = 0;
    domEnd = Math.min(slots.length, COLUMNS * 8);
  }

  const dom = slots.slice(domStart, domEnd) as TicketSlot[];

  const budget = CANVAS_BAND_CAPACITY;
  const domCount = domEnd - domStart;
  const overscanBudget = Math.max(0, budget - domCount);
  const aboveWant = Math.floor(overscanBudget / 2);
  const belowWant = overscanBudget - aboveWant;

  let canvasStart = Math.max(0, domStart - aboveWant);
  let canvasEnd = Math.min(slots.length, domEnd + belowWant);

  const usedAbove = domStart - canvasStart;
  const usedBelow = canvasEnd - domEnd;
  const leftover = overscanBudget - usedAbove - usedBelow;
  if (leftover > 0) {
    if (canvasStart === 0) {
      canvasEnd = Math.min(slots.length, canvasEnd + leftover);
    } else if (canvasEnd === slots.length) {
      canvasStart = Math.max(0, canvasStart - leftover);
    }
  }

  if (canvasEnd - canvasStart > budget) {
    const excess = canvasEnd - canvasStart - budget;
    const trimAbove = Math.min(usedAbove, Math.ceil(excess / 2));
    canvasStart += trimAbove;
    canvasEnd = canvasStart + budget;
    if (canvasEnd < domEnd) {
      canvasEnd = Math.min(slots.length, domEnd);
      canvasStart = Math.max(0, canvasEnd - budget);
    }
    if (canvasStart > domStart) {
      canvasStart = Math.max(0, domStart);
      canvasEnd = Math.min(slots.length, canvasStart + budget);
    }
  }

  const canvas = slots.slice(canvasStart, canvasEnd) as TicketSlot[];

  return {
    dom,
    canvas,
    above: Math.max(0, domStart - canvasStart),
    below: Math.max(0, canvasEnd - domEnd),
  };
}
