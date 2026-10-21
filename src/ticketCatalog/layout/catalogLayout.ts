import { type TicketMetrics, DESKTOP_MEDIUM } from '../model/ticketPresets';

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

/**
 * Mobile 3-across vs 2-across — aspect ratio from layout viewport, not `matchMedia(orientation)`.
 * Prefer catalog frame width + scroll client height (caller); defaults are `window` for /compare.
 */
export function catalogLayoutIsLandscape(
  width = window.innerWidth,
  height = window.innerHeight,
): boolean {
  return width > height;
}

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

/** Stable key for atlas warm + canvas paint (card width changes invalidate). */
export function catalogLayoutCacheKey(layout: CatalogLayout): string {
  return `${layout.metrics.id}|${layout.cardWidth}|${layout.columns}|${layout.cardHeight}`;
}

export function rowHeight(layout: CatalogLayout = active): number {
  return layout.cardHeight + layout.gap;
}

export function contentWidth(layout: CatalogLayout = active): number {
  return layout.columns * layout.cardWidth + (layout.columns - 1) * layout.gap;
}

/** Canvas / tile width — same as `ticketCatalog__content` (grid px, not scroll client). */
export function catalogLaneWidth(layout: CatalogLayout = active): number {
  return contentWidth(layout);
}

export function contentHeight(ticketCount: number, layout: CatalogLayout = active): number {
  const rows = Math.ceil(ticketCount / layout.columns);
  if (rows === 0) return 0;
  return rows * layout.cardHeight + (rows - 1) * layout.gap;
}

export function readCatalogCardHeight(el: HTMLElement | null, fallback = 43): number {
  if (!el) return fallback;
  const raw = parseFloat(getComputedStyle(el).getPropertyValue("--ticket-card-height"));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** @pp/core `--core-media-larger-than-wide` */
function isCoreLargerThanWide(width: number, height: number): boolean {
  return width >= 1024 && height >= 500;
}

/** @pp/core `--core-media-smaller-than-extra-extra-wide`: (width < 1800) OR (height < 500) */
function isCoreSmallerThanExtraExtraWide(width: number, height: number): boolean {
  return width < 1800 || height < 500;
}

/** @pp/core `--core-media-smaller-than-extra-wide`: (width < 1512) OR (height < 500) */
function isCoreSmallerThanExtraWide(width: number, height: number): boolean {
  return width < 1512 || height < 500;
}

/**
 * FM `TicketCatalog.module.css` scrollbar gap — same cascade as postcss custom-media AND/OR.
 * Rules apply in order; later matches win (4 → 3.5 → 3).
 */
export function resolveCatalogScrollbarGap(
  width = window.innerWidth,
  height = window.innerHeight,
): number {
  if (!isCoreLargerThanWide(width, height)) return 0;
  let gap = 4;
  if (isCoreSmallerThanExtraExtraWide(width, height)) gap = 3.5;
  if (isCoreSmallerThanExtraWide(width, height)) gap = 3;
  return gap;
}

export function resolveCatalogScrollbarTrackWidth(
  width = window.innerWidth,
  height = window.innerHeight,
): number {
  return resolveCatalogScrollbarGap(width, height) > 0 ? 6 : 0;
}

/** FM reserve when the native track sits inside `.ticketCatalog` (gap + track width from CSS vars). */
export function readCatalogScrollbarReserve(el: HTMLElement | null): number {
  if (!el) return 0;
  const cs = getComputedStyle(el);
  const gap = parseFloat(cs.getPropertyValue("--catalog-scrollbar-gap")) || 0;
  const width = parseFloat(cs.getPropertyValue("--catalog-scrollbar-width")) || 0;
  return gap + width;
}

export function readCatalogSpacerRows(el: HTMLElement | null, fallback = 3): number {
  if (!el) return fallback;
  const raw = parseFloat(getComputedStyle(el).getPropertyValue("--catalog-spacer-rows"));
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

/** Approximate cell CSS width for fallback before measure (flex:1 + separators). */
export function approxCellWidth(layout: CatalogLayout = active): number {
  const seps = 5 * layout.metrics.separatorWidth;
  return (layout.cardWidth - seps) / 6;
}
