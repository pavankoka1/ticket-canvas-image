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

/**
 * Fortunamania `.ticketGrid__ticket` while bets are open.
 * Rule order matches `GameGrid.module.css` (a later match wins).
 */
export function resolveTicketFrame(width: number, height: number): { width: number; height: number } {
  const smallerThanMediumWide = width < 1366 || height < 500;
  const smallerThanWide = width < 1024 || height < 500;
  const smallerThanMedium = width < 620;
  const largerThanMedium = width >= 620;
  const largerThanNarrow = width >= 375;
  const portrait = height >= width;
  const landscape = width > height;
  const compressed = height < 320 || width < 360;

  let frameW = 1001;
  let frameH = 231;

  if (smallerThanMediumWide) {
    frameW = 901;
    frameH = 211;
  }
  if (smallerThanWide && landscape) {
    frameW = 518;
    frameH = 201;
  }
  if (landscape && compressed) {
    frameW = 458;
    frameH = 176;
  }
  if (portrait && smallerThanWide) {
    frameW = Math.min(612, Math.max(0, width - 16));
    frameH = 160;
  }
  if (portrait && smallerThanWide && largerThanMedium) frameH = 209;
  if (portrait && smallerThanMedium) frameH = 119;
  if (portrait && largerThanNarrow && smallerThanMedium && height >= 720) frameH = 119;
  if (portrait && smallerThanMedium && height <= 719) frameH = 160;
  if (portrait && compressed) frameH = 104;

  return { width: frameW, height: frameH };
}

/** Trailing rows under the last ticket. Bets open: desktop 3, portrait 1, landscape phone 2. */
export function catalogSpacerRows(width: number, height: number): number {
  const smallerThanWide = width < 1024 || height < 500;
  const portrait = height >= width;
  const landscape = width > height;
  if (landscape && smallerThanWide) return 2;
  if (portrait && smallerThanWide) return 1;
  return 3;
}

/** Approximate cell CSS width for fallback before measure (flex:1 + separators). */
export function approxCellWidth(layout: CatalogLayout = active): number {
  const seps = 5 * layout.metrics.separatorWidth;
  return (layout.cardWidth - seps) / 6;
}
