/**
 * Fortunamania ticket tokens — `TicketCatalog.module.css` + `Ticket.module.css`.
 *
 * `resolveTicketMetrics` replays that stylesheet's media cascade on the layout
 * viewport, so the DOM overlay, the canvas atlas and the CSS all read one source.
 */

import { activeDpr, snapCss } from "../layout/cellBoxModel";

export type TicketPresetId =
  | "desktopMedium"
  | "desktopSmall"
  | "mobile"
  | "mobilePhone"
  | "mobileTablet"
  | "mobileCompact";

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
  /** `--ticket-cell-margin-top`: moves cells and separators down. */
  cellMarginTop: number;
  /** `--ticket-number-drop`: moves cells down, separators stay. */
  numberDrop: number;
  /** `--ticket-separator-lift`: moves separators up. */
  separatorLift: number;
};

type Offsets = Pick<TicketMetrics, "cellMarginTop" | "numberDrop" | "separatorLift">;

const NO_OFFSETS: Offsets = { cellMarginTop: 0, numberDrop: 0, separatorLift: 0 };
const MOBILE_SHADOW = "0 1.721px 0.86px rgb(0 0 0 / 42%)";

/** ≥1366×500 — `.ticketCatalog` base tokens. */
export const DESKTOP_MEDIUM: TicketMetrics = {
  id: "desktopMedium",
  label: "Desktop medium (≥1366×500)",
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
  ...NO_OFFSETS,
};

/** `--core-media-smaller-than-medium-wide`. */
export const DESKTOP_SMALL: TicketMetrics = {
  ...DESKTOP_MEDIUM,
  id: "desktopSmall",
  label: "Desktop small (1024–1365)",
  cardHeight: 39,
  headerHeight: 15,
  bodyHeight: 24,
  bodyPaddingY: 2.75,
  cellHeight: 18.5,
  numberLineHeight: 18.5,
  numberFontSize: 16,
  metaFontSize: 11,
  separatorMarginTop: 3.75,
  separatorHeight: 11,
  dabSize: 22,
};

/** `--core-media-smaller-than-wide`. */
export const MOBILE: TicketMetrics = {
  ...DESKTOP_SMALL,
  id: "mobile",
  label: "Mobile (<1024 or <500 tall)",
  cardHeight: 37,
  headerHeight: 15,
  bodyHeight: 22,
  bodyPaddingY: 1.5,
  cellHeight: 19,
  numberLineHeight: 17.5,
  numberFontSize: 15,
  metaFontSize: 10,
  separatorMarginTop: 4.5,
  separatorHeight: 10,
  radius: 3,
  dabSize: 21,
  cardShadow: MOBILE_SHADOW,
};

/** Portrait phones 360–499 wide, ≥640 tall (360×640, 375×667, 375×720). */
export const MOBILE_PHONE: TicketMetrics = {
  ...MOBILE,
  id: "mobilePhone",
  label: "Mobile phone portrait (360–499)",
  headerPadX: 4,
  separatorMarginTop: 4,
  separatorWidth: 1,
  dabSize: 20,
};

/** `--game-media-tablet-portrait` — 304×67. */
export const MOBILE_TABLET: TicketMetrics = {
  ...MOBILE,
  id: "mobileTablet",
  label: "Tablet portrait (≥620)",
  cardHeight: 67,
  headerHeight: 26,
  bodyHeight: 41,
  bodyPaddingY: 4,
  headerPadX: 6,
  cellHeight: 33,
  numberLineHeight: 33,
  numberFontSize: 28,
  metaFontSize: 19,
  separatorMarginTop: 6,
  separatorWidth: 2,
  separatorHeight: 19,
  radius: 6,
  dabSize: 37,
};

/** `--core-media-compressed` — height < 320 or width < 360. */
export const MOBILE_COMPACT: TicketMetrics = {
  ...MOBILE,
  id: "mobileCompact",
  label: "Mobile compact (<360 wide or <320 tall)",
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
  MOBILE_PHONE,
  MOBILE_TABLET,
  MOBILE_COMPACT,
];

export function getPreset(id: TicketPresetId): TicketMetrics {
  return TICKET_PRESETS.find((p) => p.id === id) ?? DESKTOP_MEDIUM;
}

/** @pp/core media atoms on a layout viewport (CSS orientation: portrait when h ≥ w). */
function viewportMedia(width: number, height: number) {
  const portrait = height >= width;
  const smallerThanWide = width < 1024 || height < 500;
  const smallerThanMediumWide = width < 1366 || height < 500;
  return {
    portrait,
    landscape: !portrait,
    smallerThanWide,
    smallerThanMediumWide,
    largerThanMediumWide: !smallerThanMediumWide,
    compressed: height < 320 || width < 360,
    tabletPortrait: portrait && width >= 620 && smallerThanWide,
  };
}

/** `.ticketCatalog` preset blocks, in stylesheet order (later rules win). */
export function resolvePresetId(width: number, height: number): TicketPresetId {
  const m = viewportMedia(width, height);
  let id: TicketPresetId = "desktopMedium";
  if (m.smallerThanMediumWide) id = "desktopSmall";
  if (m.smallerThanWide) id = "mobile";
  if (m.compressed) id = "mobileCompact";
  if (m.portrait && width >= 360 && width <= 499 && height >= 640) id = "mobilePhone";
  if (m.tabletPortrait) id = "mobileTablet";
  return id;
}

/** `--ticket-cell-margin-top`, `--ticket-number-drop`, `--ticket-separator-lift` blocks. */
function resolveOffsets(width: number, height: number): Offsets {
  const m = viewportMedia(width, height);
  let cellMarginTop = 0;
  if (m.largerThanMediumWide) cellMarginTop = 2;
  if (m.tabletPortrait) cellMarginTop = 1;
  const mediumLandscape =
    m.landscape && m.smallerThanWide && width >= 620 && height >= 375 && height < 500;
  const largeLandscape = m.landscape && m.smallerThanWide && height >= 500;
  if (largeLandscape) cellMarginTop = 1;
  return {
    cellMarginTop,
    numberDrop: mediumLandscape ? 1 : 0,
    separatorLift: m.largerThanMediumWide ? 2 : 0,
  };
}

/** Full token set for a layout viewport (defaults to the window). */
export function resolveTicketMetrics(
  width = window.innerWidth,
  height = window.innerHeight,
): TicketMetrics {
  return { ...getPreset(resolvePresetId(width, height)), ...resolveOffsets(width, height) };
}

/** Cell (number box) top in card CSS px, on the active DPR grid. */
export function snappedTicketNumberTop(m: TicketMetrics, dpr = activeDpr()): number {
  return snapCss(m.headerHeight + m.bodyPaddingY + m.cellMarginTop + m.numberDrop, dpr);
}

/** Separator top in card CSS px (Ticket.module.css `::before` top), on the DPR grid. */
export function snappedTicketSeparatorTop(m: TicketMetrics, dpr = activeDpr()): number {
  return snapCss(
    m.headerHeight + m.bodyPaddingY + m.cellMarginTop + m.separatorMarginTop - m.separatorLift,
    dpr,
  );
}

/** Body padding that puts HTML cells on `snappedTicketNumberTop` (offsets folded in). */
export function snappedTicketBodyPaddingY(m: TicketMetrics, dpr = activeDpr()): number {
  return snappedTicketNumberTop(m, dpr) - m.headerHeight;
}

/** `box-shadow: 0 Ypx Bpx rgb(0 0 0 / A%)` → SVG drop-shadow; null for none. */
export function parseTicketShadow(
  shadow: string,
): { dy: number; stdDeviation: number; opacity: number } | null {
  const match = /^\s*0(?:px)?\s+([\d.]+)px\s+([\d.]+)px\s+rgb\(0 0 0 \/ ([\d.]+)%\)\s*$/.exec(shadow);
  if (!match) return null;
  return {
    dy: Number(match[1]),
    stdDeviation: Number(match[2]) / 2,
    opacity: Number(match[3]) / 100,
  };
}

export function applyTicketCssVars(el: HTMLElement, m: TicketMetrics, dpr = activeDpr()): void {
  const s = el.style;
  s.setProperty("--ticket-card-height", `${m.cardHeight}px`);
  s.setProperty("--catalog-card-height", `${m.cardHeight}px`);
  s.setProperty("--ticket-header-height", `${m.headerHeight}px`);
  s.setProperty("--ticket-body-height", `${m.bodyHeight}px`);
  s.setProperty("--ticket-body-padding-y", `${snappedTicketBodyPaddingY(m, dpr)}px`);
  s.setProperty("--ticket-header-pad-x", `${m.headerPadX}px`);
  // Cell w/h come from applyCellBoxCssVars (fixed-px model) — do not set here.
  s.setProperty("--ticket-number-line-height", `${m.numberLineHeight}px`);
  s.setProperty("--ticket-number-font-size", `${m.numberFontSize}px`);
  s.setProperty("--ticket-meta-font-size", `${m.metaFontSize}px`);
  s.setProperty("--ticket-separator-margin-top", `${m.separatorMarginTop}px`);
  s.setProperty(
    "--ticket-separator-top",
    `${snappedTicketSeparatorTop(m, dpr) - snappedTicketNumberTop(m, dpr)}px`,
  );
  s.setProperty("--ticket-separator-width", `${m.separatorWidth}px`);
  s.setProperty("--ticket-separator-height", `${m.separatorHeight}px`);
  s.setProperty("--ticket-radius", `${m.radius}px`);
  s.setProperty("--ticket-dab-size", `${m.dabSize}px`);
  s.setProperty("--ticket-card-shadow", m.cardShadow || "none");
  s.setProperty("--catalog-gap", "4px");
}
