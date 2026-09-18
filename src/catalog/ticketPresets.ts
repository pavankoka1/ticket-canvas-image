/**
 * Fortunamania ticket size tokens — mirrored from
 * `TicketCatalog.module.css` + `Ticket.module.css`.
 */

export type TicketPresetId =
  "desktopMedium" | "desktopSmall" | "mobile" | "mobileLarge" | "mobileCompact";

export type TicketMetrics = {
  id: TicketPresetId;
  label: string;
  cardHeight: number;
  headerHeight: number;
  bodyHeight: number;
  bodyPaddingY: number;
  headerPadX: number;
  cellHeight: number;
  numberLineHeight: number;
  numberFontSize: number;
  metaFontSize: number;
  separatorMarginTop: number;
  separatorWidth: number;
  separatorHeight: number;
  radius: number;
  dabSize: number;
  /** CSS box-shadow value; empty = none. */
  cardShadow: string;
};

/** ≥1366×500 — default catalog tokens. */
export const DESKTOP_MEDIUM: TicketMetrics = {
  id: "desktopMedium",
  label: "Desktop medium (≥1366)",
  cardHeight: 43,
  headerHeight: 17,
  bodyHeight: 26,
  bodyPaddingY: 2.5,
  headerPadX: 4,
  cellHeight: 21,
  numberLineHeight: 21,
  numberFontSize: 18,
  metaFontSize: 12,
  separatorMarginTop: 4.5,
  separatorWidth: 1,
  separatorHeight: 12,
  radius: 5,
  dabSize: 24,
  cardShadow: "",
};

/** 1024–1365 — desktopSmall. */
export const DESKTOP_SMALL: TicketMetrics = {
  id: "desktopSmall",
  label: "Desktop small (1024–1365)",
  cardHeight: 39,
  headerHeight: 15,
  bodyHeight: 24,
  bodyPaddingY: 2.75,
  headerPadX: 4,
  cellHeight: 18.5,
  numberLineHeight: 18.5,
  numberFontSize: 16,
  metaFontSize: 11,
  separatorMarginTop: 3.75,
  separatorWidth: 1,
  separatorHeight: 11,
  radius: 5,
  dabSize: 22,
  cardShadow: "",
};

/** <1024 — base mobile. */
export const MOBILE: TicketMetrics = {
  id: "mobile",
  label: "Mobile (<1024)",
  cardHeight: 37,
  headerHeight: 15,
  bodyHeight: 22,
  bodyPaddingY: 1.5,
  headerPadX: 4,
  cellHeight: 19,
  numberLineHeight: 17.5,
  numberFontSize: 15,
  metaFontSize: 10,
  separatorMarginTop: 4.5,
  separatorWidth: 1,
  separatorHeight: 10,
  radius: 3,
  dabSize: 20.65116310119629,
  cardShadow: "0 1.721px 0.86px rgb(0 0 0 / 42%)",
};

/** Portrait mobile ≥620 — large portrait band. */
export const MOBILE_LARGE: TicketMetrics = {
  id: "mobileLarge",
  label: "Mobile large (portrait ≥620)",
  cardHeight: 43,
  headerHeight: 17,
  bodyHeight: 26,
  bodyPaddingY: 2.5,
  headerPadX: 4,
  cellHeight: 21,
  numberLineHeight: 21,
  numberFontSize: 18,
  metaFontSize: 12,
  separatorMarginTop: 4.5,
  separatorWidth: 1,
  separatorHeight: 12,
  radius: 5,
  dabSize: 24,
  cardShadow: "0 1.721px 0.86px rgb(0 0 0 / 42%)",
};

/** ≤499 or compressed landscape. */
export const MOBILE_COMPACT: TicketMetrics = {
  id: "mobileCompact",
  label: "Mobile compact (≤499)",
  cardHeight: 32,
  headerHeight: 13,
  bodyHeight: 19,
  bodyPaddingY: 1,
  headerPadX: 2,
  cellHeight: 17,
  numberLineHeight: 17,
  numberFontSize: 13,
  metaFontSize: 9,
  separatorMarginTop: 4,
  separatorWidth: 1,
  separatorHeight: 9,
  radius: 3,
  dabSize: 17,
  cardShadow: "0 1.488px 0.744px rgb(0 0 0 / 42%)",
};

export const TICKET_PRESETS: readonly TicketMetrics[] = [
  DESKTOP_MEDIUM,
  DESKTOP_SMALL,
  MOBILE,
  MOBILE_LARGE,
  MOBILE_COMPACT,
];

export function getPreset(id: TicketPresetId): TicketMetrics {
  return TICKET_PRESETS.find((p) => p.id === id) ?? DESKTOP_MEDIUM;
}

/**
 * Auto-pick like TicketCatalog.module.css media cascade
 * (last matching rule wins conceptually — we evaluate most specific first).
 */
export function resolvePresetFromViewport(
  width = window.innerWidth,
  height = window.innerHeight,
): TicketMetrics {
  const isWide = width >= 1024 && height >= 500;
  const isMediumWide = width >= 1366 && height >= 500;
  const isPortrait = height >= width;
  const isLandscape = width > height;
  const isCompressed = height < 320 || width < 360;

  if (!isWide) {
    if (width <= 499 || (isLandscape && isCompressed)) return MOBILE_COMPACT;
    if (isPortrait && width >= 620) return MOBILE_LARGE;
    return MOBILE;
  }
  if (!isMediumWide) return DESKTOP_SMALL;
  return DESKTOP_MEDIUM;
}

/** Apply fortunamania CSS custom properties onto a host. */
export function applyTicketCssVars(el: HTMLElement, m: TicketMetrics): void {
  const s = el.style;
  s.setProperty("--ticket-card-height", `${m.cardHeight}px`);
  s.setProperty("--ticket-header-height", `${m.headerHeight}px`);
  s.setProperty("--ticket-body-height", `${m.bodyHeight}px`);
  s.setProperty("--ticket-body-padding-y", `${m.bodyPaddingY}px`);
  s.setProperty("--ticket-header-pad-x", `${m.headerPadX}px`);
  // Cell w/h come from applyCellBoxCssVars (fixed-px model) — do not set here.
  s.setProperty("--ticket-number-line-height", `${m.numberLineHeight}px`);
  s.setProperty("--ticket-number-font-size", `${m.numberFontSize}px`);
  s.setProperty("--ticket-meta-font-size", `${m.metaFontSize}px`);
  s.setProperty("--ticket-separator-margin-top", `${m.separatorMarginTop}px`);
  s.setProperty("--ticket-separator-width", `${m.separatorWidth}px`);
  s.setProperty("--ticket-separator-height", `${m.separatorHeight}px`);
  s.setProperty("--ticket-radius", `${m.radius}px`);
  s.setProperty("--ticket-dab-size", `${m.dabSize}px`);
  s.setProperty("--ticket-card-shadow", m.cardShadow || "none");
  s.setProperty("--catalog-gap", "4px");
}
