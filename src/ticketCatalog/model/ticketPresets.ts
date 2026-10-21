/**
 * Fortunamania ticket size tokens — mirrored from
 * `TicketCatalog.module.css` + `Ticket.module.css`.
 */

import { activeDpr, snapCss } from "../layout/cellBoxModel";

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
  radius: 4,
  dabSize: 24,
  cardShadow: "0 2px 1px rgb(0 0 0 / 42%)",
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

/** Layout viewport — Safari URL bar can make `innerHeight` disagree with CSS media. */
export function catalogLayoutViewport(
  width = window.innerWidth,
  height = window.innerHeight,
): { width: number; height: number } {
  const vv = window.visualViewport;
  if (!vv) return { width, height };
  return {
    width: Math.round(vv.width) || width,
    height: Math.round(vv.height) || height,
  };
}

/**
 * Preset id from `index.css` `.ticketCatalog` media order (later rules override).
 * Do not infer from `--ticket-card-height` alone — 43px is both mobileLarge and desktopMedium.
 */
export function resolvePresetIdFromCssMedia(): TicketPresetId {
  const m = (query: string) => window.matchMedia(query).matches;
  let id: TicketPresetId = "desktopMedium";
  if (m("(max-width: 1365px), (max-height: 499px)")) id = "desktopSmall";
  if (m("(max-width: 1023px), (max-height: 499px)")) id = "mobile";
  if (m("(max-width: 1023px) and (orientation: portrait) and (min-width: 620px)")) {
    id = "mobileLarge";
  }
  if (m("(max-height: 319px), (max-width: 359px)")) id = "mobileCompact";
  if (
    m(
      "(orientation: portrait) and (min-width: 360px) and (max-width: 499px) and (min-height: 640px)",
    )
  ) {
    id = "mobile";
  }
  return id;
}

/**
 * Catalog layout preset from ticket-box width + aspect (no `max-height` media).
 * Avoids Safari URL-bar height flicker flipping `metrics.id` and cancelling motion.
 */
export function resolvePresetIdForCatalog(width: number, isLandscape: boolean): TicketPresetId {
  let id: TicketPresetId = "desktopMedium";
  if (width <= 1365) id = "desktopSmall";
  if (width <= 1023) id = "mobile";
  if (width <= 1023 && !isLandscape && width >= 620) id = "mobileLarge";
  if (width <= 359) id = "mobileCompact";
  if (!isLandscape && width >= 360 && width <= 499) id = "mobile";
  return id;
}

/**
 * Auto-pick like TicketCatalog.module.css media cascade
 * (last matching rule wins conceptually — we evaluate most specific first).
 */
export function resolvePresetFromViewport(
  _width = catalogLayoutViewport().width,
  _height = catalogLayoutViewport().height,
): TicketMetrics {
  return getPreset(resolvePresetIdFromCssMedia());
}

/** Body band top in CSS px on the active DPR grid (header + pad, snapped once). */
export function snappedTicketNumberTop(m: TicketMetrics, dpr = activeDpr()): number {
  return snapCss(m.headerHeight + m.bodyPaddingY, dpr);
}

/** `--ticket-body-padding-y` that matches `snappedTicketNumberTop` (header is integer). */
export function snappedTicketBodyPaddingY(m: TicketMetrics, dpr = activeDpr()): number {
  return snappedTicketNumberTop(m, dpr) - m.headerHeight;
}

/** Apply fortunamania CSS custom properties onto a host. */
function parseCssPx(cs: CSSStyleDeclaration, prop: string, fallback: number): number {
  const raw = parseFloat(cs.getPropertyValue(prop));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Read fortunamania ticket tokens from `.ticketCatalog` after media queries apply. */
export type ReadTicketMetricsOpts = {
  /** When set, preset id follows width + landscape only (catalog resize stability). */
  catalogWidth?: number;
  catalogLandscape?: boolean;
};

export function readTicketMetricsFromCss(
  el: HTMLElement,
  fallback: TicketMetrics = DESKTOP_MEDIUM,
  opts?: ReadTicketMetricsOpts,
): TicketMetrics {
  const cs = getComputedStyle(el);
  const id =
    opts?.catalogWidth !== undefined
      ? resolvePresetIdForCatalog(opts.catalogWidth, opts.catalogLandscape ?? false)
      : resolvePresetIdFromCssMedia();
  const base = getPreset(id);
  const catalogStable = opts?.catalogWidth !== undefined;
  const cardHeight = catalogStable
    ? base.cardHeight
    : parseCssPx(cs, "--ticket-card-height", base.cardHeight);
  const cardShadowRaw = cs.getPropertyValue("--ticket-card-shadow").trim();
  return {
    id,
    label: base.label,
    cardHeight,
    headerHeight: parseCssPx(cs, "--ticket-header-height", fallback.headerHeight),
    bodyHeight: parseCssPx(cs, "--ticket-body-height", fallback.bodyHeight),
    bodyPaddingY: parseCssPx(cs, "--ticket-body-padding-y", fallback.bodyPaddingY),
    headerPadX: parseCssPx(cs, "--ticket-header-pad-x", fallback.headerPadX),
    cellHeight: parseCssPx(cs, "--ticket-cell-height", fallback.cellHeight),
    numberLineHeight: parseCssPx(cs, "--ticket-number-line-height", fallback.numberLineHeight),
    numberFontSize: parseCssPx(cs, "--ticket-number-font-size", fallback.numberFontSize),
    metaFontSize: parseCssPx(cs, "--ticket-meta-font-size", fallback.metaFontSize),
    separatorMarginTop: parseCssPx(cs, "--ticket-separator-margin-top", fallback.separatorMarginTop),
    separatorWidth: parseCssPx(cs, "--ticket-separator-width", fallback.separatorWidth),
    separatorHeight: parseCssPx(cs, "--ticket-separator-height", fallback.separatorHeight),
    radius: parseCssPx(cs, "--ticket-radius", fallback.radius),
    dabSize: parseCssPx(cs, "--ticket-dab-size", fallback.dabSize),
    cardShadow:
      cardShadowRaw && cardShadowRaw !== "none" ? cardShadowRaw : base.cardShadow,
  };
}

/** Strip inline ticket tokens so `index.css` / FM media queries on `.ticketCatalog` win. */
export function clearTicketCssVarsInline(el: HTMLElement): void {
  const s = el.style;
  s.removeProperty("--ticket-card-height");
  s.removeProperty("--ticket-header-height");
  s.removeProperty("--ticket-body-height");
  s.removeProperty("--ticket-body-padding-y");
  s.removeProperty("--ticket-header-pad-x");
  s.removeProperty("--ticket-number-line-height");
  s.removeProperty("--ticket-number-font-size");
  s.removeProperty("--ticket-meta-font-size");
  s.removeProperty("--ticket-separator-margin-top");
  s.removeProperty("--ticket-separator-width");
  s.removeProperty("--ticket-separator-height");
  s.removeProperty("--ticket-radius");
  s.removeProperty("--ticket-dab-size");
  s.removeProperty("--ticket-card-shadow");
  s.removeProperty("--catalog-gap");
}

export function applyTicketCssVars(el: HTMLElement, m: TicketMetrics, dpr = activeDpr()): void {
  const s = el.style;
  s.setProperty("--ticket-card-height", `${m.cardHeight}px`);
  s.setProperty("--ticket-header-height", `${m.headerHeight}px`);
  s.setProperty("--ticket-body-height", `${m.bodyHeight}px`);
  s.setProperty("--ticket-body-padding-y", `${snappedTicketBodyPaddingY(m, dpr)}px`);
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
