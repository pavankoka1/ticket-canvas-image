/**
 * Integer CSS cell grid — matches flex row (no fractional cellW, no per-index DPR snap).
 *
 * cellW = floor((ticketWidth − 5×separatorWidth) / 6)
 * left(i) = i × (cellW + separatorWidth)
 * top = headerHeight + bodyPaddingY
 */

import { getActiveLayout, type CatalogLayout } from "./catalogLayout";
import { activeDpr, snapCss, type CellBox } from "./cellBoxModel";

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

export function resolveTicketCellGeometry(
  layout: CatalogLayout,
  dpr = activeDpr(),
): TicketCellGeometry {
  const m = layout.metrics;
  const sep = m.separatorWidth;
  const cardW = layout.cardWidth;
  const cellW = Math.max(1, Math.floor((cardW - 5 * sep) / 6));
  const cellH = Math.round(m.cellHeight);
  const numberTop = snapCss(m.headerHeight + m.bodyPaddingY, dpr);
  const bodyPaddingY = numberTop - m.headerHeight;
  const badgeTop = m.headerHeight;
  const padX = 0;
  const stride = cellW + sep;

  const numbers: CellBox[] = [];
  for (let i = 0; i < 6; i++) {
    numbers.push({ x: i * stride, y: numberTop, w: cellW, h: cellH });
  }

  return {
    dpr,
    cardWidth: cardW,
    cellW,
    cellH,
    sep,
    padX,
    numberTop,
    badgeTop,
    bodyPaddingY,
    numbers,
  };
}

export function badgeCapturePads(): { padX: number; padY: number } {
  const geo = resolveTicketCellGeometry(getActiveLayout());
  return { padX: BADGE_CAPTURE_PAD_X, padY: geo.bodyPaddingY };
}
