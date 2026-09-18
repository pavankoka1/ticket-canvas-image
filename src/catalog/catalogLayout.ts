import { type TicketMetrics, DESKTOP_MEDIUM } from './ticketPresets';

/** Mirrors fortunamania `catalogLayout.ts`. */
export const CATALOG_GAP = 4;
const DESKTOP_COLUMNS = 5;
const LANDSCAPE_COLUMNS = 3;
const PORTRAIT_COLUMNS = 2;
const MIN_CARD_WIDTH_DESKTOP = 177;
const MIN_CARD_WIDTH_MOBILE = 150;

export type CatalogLayout = {
  columns: number;
  cardWidth: number;
  cardHeight: number;
  gap: number;
  metrics: TicketMetrics;
  isMobile: boolean;
};

export function resolveCatalogLayout(
  isMobile: boolean,
  isLandscape: boolean,
  availableWidth: number,
  metrics: TicketMetrics
): CatalogLayout {
  const preferred = !isMobile ? DESKTOP_COLUMNS : isLandscape ? LANDSCAPE_COLUMNS : PORTRAIT_COLUMNS;
  const minWidth = isMobile ? MIN_CARD_WIDTH_MOBILE : MIN_CARD_WIDTH_DESKTOP;
  const columns =
    availableWidth <= 0
      ? preferred
      : Math.max(
          1,
          Math.min(preferred, Math.floor((availableWidth + CATALOG_GAP) / (minWidth + CATALOG_GAP)))
        );
  const cardWidth =
    availableWidth > 0
      ? Math.floor((availableWidth - (columns - 1) * CATALOG_GAP) / columns)
      : minWidth;

  return {
    columns,
    cardWidth: Math.max(cardWidth, 1),
    cardHeight: metrics.cardHeight,
    gap: CATALOG_GAP,
    metrics,
    isMobile,
  };
}

/** Active layout for pools / atlas / bands (set by Catalog). */
let active: CatalogLayout = resolveCatalogLayout(false, false, 1000, DESKTOP_MEDIUM);

export function getActiveLayout(): CatalogLayout {
  return active;
}

export function setActiveLayout(next: CatalogLayout): void {
  active = next;
}

export function rowHeight(layout: CatalogLayout = active): number {
  return layout.cardHeight + layout.gap;
}

export function contentWidth(layout: CatalogLayout = active): number {
  return layout.columns * layout.cardWidth + (layout.columns - 1) * layout.gap;
}

export function contentHeight(ticketCount: number, layout: CatalogLayout = active): number {
  const rows = Math.ceil(ticketCount / layout.columns);
  if (rows === 0) return 0;
  return rows * layout.cardHeight + (rows - 1) * layout.gap;
}

/** Approximate cell CSS width for fallback before measure (flex:1 + separators). */
export function approxCellWidth(layout: CatalogLayout = active): number {
  const seps = 5 * layout.metrics.separatorWidth;
  return (layout.cardWidth - seps) / 6;
}
