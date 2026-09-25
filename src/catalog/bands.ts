import { getActiveLayout, rowHeight } from './catalogLayout';
import { DOM_POOL_SIZE } from './layout';
import type { TicketSlot } from './tickets';

export type DomBand = {
  dom: TicketSlot[];
};

/**
 * DOM near-viewport window only. Canvas paints the full catalog in tiles —
 * no canvas band / capacity trim.
 */
export function computeDomBand(
  slots: readonly TicketSlot[],
  scrollTop: number,
  viewportH: number,
  bufferRows: number,
  poolSize: number = DOM_POOL_SIZE,
): DomBand {
  if (slots.length === 0) return { dom: [] };

  const layout = getActiveLayout();
  const columns = layout.columns;
  const rh = rowHeight(layout);
  const viewH = Math.max(viewportH, rh);
  const top = Math.max(0, scrollTop - bufferRows * rh);
  const bottom = scrollTop + viewH + bufferRows * rh;
  const startRow = Math.floor(top / rh);
  const endRow = Math.ceil(bottom / rh);
  let domStart = Math.max(0, startRow * columns);
  let domEnd = Math.min(slots.length, endRow * columns);
  if (domStart >= domEnd) {
    domStart = 0;
    domEnd = Math.min(slots.length, columns * 8);
  }

  // Never ask for more DOM cards than the pool.
  if (domEnd - domStart > poolSize) {
    const mid = Math.floor((domStart + domEnd) / 2);
    domStart = Math.max(0, mid - Math.floor(poolSize / 2));
    domEnd = Math.min(slots.length, domStart + poolSize);
  }

  return { dom: slots.slice(domStart, domEnd) as TicketSlot[] };
}
