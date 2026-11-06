/**
 * Cell grid — Fortunamania `.ticketCard__cell { flex: 1 1 0 }` with a separator
 * margin between cells, snapped to the device grid:
 *
 * exactW = (ticketWidth − 5×separatorWidth) / 6
 * left(i) = snap(i × (exactW + separatorWidth))
 * cellW   = snap(exactW)   (one width for every cell, so per-ball sprites are shared)
 * top     = snap(header + bodyPaddingY + cellMarginTop + numberDrop)
 * cx, cy  = snapped cell box centre (x + w/2, y + h/2 — badge hosts centre here)
 */

import { getActiveLayout, type CatalogLayout } from "./catalogLayout";
import { activeDpr, snapCss, type CellBox } from "./cellBoxModel";
import { snappedTicketNumberTop } from "../model/ticketPresets";

/** Horizontal pad on dab/multiplier SVG capture (rotated N× label). */
export const BADGE_CAPTURE_PAD_X = 16;

export type TicketCellGeometry = {
  dpr: number;
  cardWidth: number;
  cellW: number;
  cellH: number;
  sep: number;
  padX: number;
  numberTop: number;
  badgeTop: number;
  bodyPaddingY: number;
  numbers: CellBox[];
};

/** Left edge of cell `i` in card CSS px (device-snapped). */
export function ticketCellLeft(i: number, cardWidth: number, sep: number, dpr: number): number {
  const exactW = Math.max(1, (cardWidth - 5 * sep) / 6);
  return snapCss(i * (exactW + sep), dpr);
}

/** Separator between cell `index` and `index + 1` — matches DOM `::before` on cell `index + 1`. */
export function ticketSeparatorLeft(
  index: number,
  cardWidth: number,
  sep: number,
  dpr: number,
): number {
  return ticketCellLeft(index + 1, cardWidth, sep, dpr) - sep;
}

export function resolveTicketCellGeometry(
  layout: CatalogLayout,
  dpr = activeDpr(),
): TicketCellGeometry {
  const m = layout.metrics;
  const sep = m.separatorWidth;
  const cardW = layout.cardWidth;
  const cellW = Math.max(1, snapCss((cardW - 5 * sep) / 6, dpr));
  const cellH = snapCss(m.cellHeight, dpr);
  const numberTop = snappedTicketNumberTop(m, dpr);
  const bodyPaddingY = numberTop - m.headerHeight;
  const cy = numberTop + cellH / 2;

  const numbers: CellBox[] = [];
  for (let i = 0; i < 6; i++) {
    const x = ticketCellLeft(i, cardW, sep, dpr);
    numbers.push({
      x,
      y: numberTop,
      w: cellW,
      h: cellH,
      cx: x + cellW / 2,
      cy,
    });
  }

  return {
    dpr,
    cardWidth: cardW,
    cellW,
    cellH,
    sep,
    padX: 0,
    numberTop,
    badgeTop: m.headerHeight,
    bodyPaddingY,
    numbers,
  };
}

export function badgeCapturePads(): { padX: number; padY: number } {
  const geo = resolveTicketCellGeometry(getActiveLayout());
  return { padX: BADGE_CAPTURE_PAD_X, padY: geo.bodyPaddingY };
}
