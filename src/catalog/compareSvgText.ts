/**
 * /compare experiment ("SVG text: all"): one SVG overlay per ticket, anchored
 * at the card's own (whole-pixel) origin, holding the header id/amount, cell
 * numbers and multiplier badges (disc + label) at numeric card coordinates.
 *
 * Why one overlay at the card origin: on iPhone, HTML text is laid out twice
 * (page and raster SVG image) and WebKit rounds the two layouts differently.
 * SVG `<text x y>` removes the line box, and anchoring the SVG viewport at the
 * card origin removes the remaining fractional box snapping (cell tops sit at
 * 19.5 / 17.75 CSS px; nested SVGs there drifted 1 device px).
 *
 * The HTML text stays in place for layout but is painted transparent. Colours
 * mirror `index.css` (normal / gold / disabled).
 */

import { dabDataUrl, discDataUrl, multiplierDefs, multiplierGroup, svgEl } from "./compareSvgMultiplier";
import {
  activeDpr,
  applyBadgeChrome,
  badgeHostDevice,
  badgeHostInCardCss,
  resolveCellBoxModel,
} from "./cellBoxModel";
import { getActiveLayout } from "./catalogLayout";
import { buildTicketChromeSvg, SVG_CHROME_CLASS } from "./ticketSvgChrome";

/** Baseline below the box centre, in em (Onest cap height ≈ 0.72 em). */
const BASELINE_EM = 0.36;
const FONT = "MB-Onest, Onest, sans-serif";
export const OVERLAY_CLASS = "ticketCard__svgOverlay";
export const SVG_FACE_CLASS = "ticketCard_svgFace";
const DRAW_BADGE_HOST_ATTR = "data-draw-badge-host";
const DRAW_MULT_LABEL_ATTR = "data-draw-mult-label";
const DRAW_CELL_ATTR = "data-draw-cell";

function badgeHostLayer(
  cell: number,
  cx: number,
  cy: number,
  size: number,
  image: SVGElement,
): SVGGElement {
  const g = svgEl("g", {
    [DRAW_BADGE_HOST_ATTR]: "",
    [DRAW_CELL_ATTR]: String(cell),
    transform: `translate(${cx} ${cy})`,
  });
  g.append(image);
  image.setAttribute("x", String(-size / 2));
  image.setAttribute("y", String(-size / 2));
  image.setAttribute("width", String(size));
  image.setAttribute("height", String(size));
  return g;
}

/** Plain dab: hide overlay dab ink, show HTML dab above the svg-all overlay during WAAPI. */
export function beginDrawDabMotion(root: HTMLElement, cell: number): void {
  const overlay = root.querySelector(`:scope > .${OVERLAY_CLASS}`);
  overlay
    ?.querySelectorAll<SVGElement>(`g[${DRAW_BADGE_HOST_ATTR}][${DRAW_CELL_ATTR}="${cell}"]`)
    .forEach((el) => {
      (el as unknown as HTMLElement).style.visibility = "hidden";
    });
  const cellEl = root.querySelectorAll<HTMLElement>(".ticketCard__cell")[cell];
  const host = cellEl?.querySelector<HTMLElement>(".ticketCard__badgeHost_dab")?.closest<HTMLElement>(
    ".ticketCard__badgeHost",
  );
  if (!host || host.style.display === "none") return;
  const disabled = root.classList.contains("ticketCard_disabled");
  host.style.backgroundImage = `url("${disabled ? "/dab-disabled.png" : "/dab-full.png"}")`;
  const layout = getActiveLayout();
  const model = resolveCellBoxModel(layout, activeDpr());
  const cellBox = model.cells[cell];
  if (cellBox) {
    const box = badgeHostDevice(cellBox, layout.metrics.dabSize, activeDpr());
    applyBadgeChrome(host, box, false, activeDpr());
  }
  host.style.zIndex = "3";
}

export type OverlayDrawLayers = { disc: SVGGElement | null; label: SVGGElement | null };

/**
 * Multiplier draw uses the same svg-all disc + label as the settled DOM (not the
 * HTML CSS label). Repaint above chrome, then WAAPI targets these groups.
 */
export function beginDrawMultiplierMotion(root: HTMLElement, cell: number): OverlayDrawLayers {
  const overlay = root.querySelector(`:scope > .${OVERLAY_CLASS}`);
  if (!overlay) return { disc: null, label: null };
  const disc = overlay.querySelector<SVGGElement>(
    `g[${DRAW_BADGE_HOST_ATTR}][${DRAW_CELL_ATTR}="${cell}"]`,
  );
  const label = overlay.querySelector<SVGGElement>(
    `g[${DRAW_MULT_LABEL_ATTR}][${DRAW_CELL_ATTR}="${cell}"]`,
  );
  if (disc) overlay.append(disc);
  if (label) overlay.append(label);
  return { disc, label };
}
const HEADER_TEXT_STYLE = "font-kerning:none;font-feature-settings:'kern' 0";

function applyHeaderTextStyle(el: SVGTextElement): void {
  el.setAttribute("style", HEADER_TEXT_STYLE);
}

const COLORS = {
  id: { normal: "#b19797", gold: "#9f8080", disabled: "#0f6864" },
  amount: { normal: "#704f4f", gold: "#704f4f", disabled: "#0f6864" },
  number: { normal: "#704f4f", gold: "#704f4f", disabled: "#193b3a" },
} as const;

function px(root: HTMLElement, name: string): number {
  return parseFloat(root.style.getPropertyValue(name)) || 0;
}

function textOf(el: Element | null): string {
  if (!el) return "";
  return [...el.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => (n as Text).data)
    .join("")
    .trim();
}

/** Dab / multiplier cells must not paint the ball digit in the SVG overlay. */
function cellOverlayNumber(cell: HTMLElement): string {
  if (cell.classList.contains("ticketCard__cell_hit")) return "";
  const host = cell.querySelector<HTMLElement>(".ticketCard__badgeHost");
  if (
    host &&
    host.style.display !== "none" &&
    (host.classList.contains("ticketCard__badgeHost_dab") ||
      host.classList.contains("ticketCard__badgeHost_multiplier"))
  ) {
    return "";
  }
  return textOf(cell);
}

function text(
  value: string,
  x: number,
  y: number,
  anchor: string,
  fontPx: number,
  fill: string,
  header = false,
): SVGTextElement {
  const t = svgEl("text", {
    x,
    y,
    "text-anchor": anchor,
    "font-family": FONT,
    "font-weight": 700,
    "font-size": fontPx,
    fill,
  });
  if (header) applyHeaderTextStyle(t);
  t.textContent = value;
  return t;
}

/** Build the overlay for `root` from its CSS variables and inline geometry. */
export function buildTicketOverlay(root: HTMLElement): SVGSVGElement {
  const face = root.classList.contains("ticketCard_disabled")
    ? "disabled"
    : root.classList.contains("ticketCard_win")
      ? "gold"
      : "normal";
  const W = px(root, "--ticket-card-width") || parseFloat(root.style.width);
  const H = px(root, "--ticket-card-height") || parseFloat(root.style.height);
  const headerH = px(root, "--ticket-header-height");
  const padX = px(root, "--ticket-header-pad-x");
  const metaPx = px(root, "--ticket-meta-font-size");
  const numberPx = px(root, "--ticket-number-font-size");
  const dab = px(root, "--ticket-dab-size");

  const layout = getActiveLayout();
  const dpr = activeDpr();
  const model = resolveCellBoxModel(layout, dpr);
  const cellW = model.cellW;
  const children: SVGElement[] = [];
  const chromeId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  if (root.classList.contains(SVG_FACE_CLASS) && cellW > 0) {
    children.push(...buildTicketChromeSvg(W, layout.metrics, face, cellW, chromeId));
  }
  const headerY = headerH / 2 + BASELINE_EM * metaPx;
  const id = textOf(root.querySelector(".ticketCard__id"));
  const amount = textOf(root.querySelector(".ticketCard__win"));
  if (id) children.push(text(id, W - padX, headerY, "end", metaPx, COLORS.id[face], true));
  if (amount) children.push(text(amount, padX, headerY, "start", metaPx, COLORS.amount[face], true));

  let needsDefs = false;
  root.querySelectorAll<HTMLElement>(".ticketCard__cell").forEach((cell, i) => {
    const cellBox = model.cells[i]!;
    const x0 = cellBox.x;
    const y0 = cellBox.y;
    const value = cellOverlayNumber(cell);
    if (value) {
      children.push(
        text(
          value,
          x0 + cellW / 2,
          y0 + cellBox.h / 2 + BASELINE_EM * numberPx,
          "middle",
          numberPx,
          COLORS.number[face],
        ),
      );
    }
    const placeBadgeInk = (host: HTMLElement | null, imageHref: string | undefined) => {
      if (!host || host.style.display === "none" || !imageHref) return;
      const { cx, cy, size } = badgeHostInCardCss(i, layout, dpr);
      children.push(
        badgeHostLayer(i, cx, cy, size, svgEl("image", { href: imageHref, preserveAspectRatio: "none" })),
      );
    };
    const dabHost = cell.querySelector<HTMLElement>(".ticketCard__badgeHost_dab");
    placeBadgeInk(dabHost, dabDataUrl(face === "disabled"));
    const host = cell.querySelector<HTMLElement>(".ticketCard__badgeHost_multiplier");
    if (!host || host.style.display === "none") return;
    const label = host.querySelector(".ticketCard__multiplierFill > span")?.textContent ?? "";
    placeBadgeInk(host, discDataUrl(face === "disabled"));
    const { cx, cy } = badgeHostInCardCss(i, layout, dpr);
    const labelWrap = svgEl("g", {
      [DRAW_MULT_LABEL_ATTR]: "",
      [DRAW_CELL_ATTR]: String(i),
      transform: `translate(${cx} ${cy})`,
    });
    labelWrap.append(
      multiplierGroup(label, 0, 0, (13 * dab) / 24, face === "disabled"),
    );
    children.push(labelWrap);
    if (face !== "disabled") needsDefs = true;
  });

  return svgEl(
    "svg",
    {
      class: OVERLAY_CLASS,
      width: W,
      height: H,
      viewBox: `0 0 ${W} ${H}`,
      overflow: "visible",
      "aria-hidden": "true",
      style: "position:absolute;left:0;top:0;z-index:2;pointer-events:none",
    },
    ...(needsDefs ? [multiplierDefs()] : []),
    ...children,
  );
}

/**
 * Badge warm captures must not bake header id/amount or cell ball digits from the
 * overlay — only multiplier disc + label groups (direct-child `<text>` only).
 */
export function stripCompareOverlayHeaderAndCellNumbers(root: HTMLElement): void {
  const overlay = root.querySelector(`:scope > .${OVERLAY_CLASS}`);
  if (!overlay) return;
  overlay.querySelectorAll(":scope > text").forEach((el) => el.remove());
}

/** Catalog chrome warm: keep vector chrome, drop ink (text / multiplier art). */
export function stripOverlayInkKeepChrome(root: HTMLElement): void {
  const overlay = root.querySelector(`:scope > .${OVERLAY_CLASS}`);
  if (!overlay) return;
  overlay.querySelectorAll(":scope > text, :scope > image, :scope > g:not(." + SVG_CHROME_CLASS + ")").forEach((el) => {
    if (el.classList.contains(SVG_CHROME_CLASS)) return;
    el.remove();
  });
}

/** Number opaque warm keeps cell digits in the overlay but drops header id/amount. */
export function stripCompareOverlayHeader(root: HTMLElement, headerHeightCss: number): void {
  const overlay = root.querySelector(`:scope > .${OVERLAY_CLASS}`);
  if (!overlay) return;
  overlay.querySelectorAll<SVGTextElement>(":scope > text").forEach((el) => {
    const y = Number(el.getAttribute("y"));
    if (y <= headerHeightCss + 0.01) el.remove();
  });
}

/** Rebuild svg-all overlay ink after draw settle (e.g. cleared cell digit). */
export function refreshSvgOverlayInk(root: HTMLElement): void {
  if (!root.querySelector(`:scope > .${OVERLAY_CLASS}`)) return;
  applySvgText(root, true);
}

/** Swap header, cell and multiplier rendering under `root` to (or back from) the overlay. */
export function applySvgText(root: HTMLElement, enabled: boolean): void {
  root.querySelector(`:scope > .${OVERLAY_CLASS}`)?.remove();
  const textEls = root.querySelectorAll<HTMLElement>(".ticketCard__id, .ticketCard__win, .ticketCard__cell");
  // Hosts are reused (dab ↔ multiplier), so every host is reset first.
  const hosts = root.querySelectorAll<HTMLElement>(".ticketCard__badgeHost");
  hosts.forEach((h) => {
    h.style.removeProperty("background-image");
    h.style.removeProperty("z-index");
    h.querySelector<HTMLElement>(".ticketCard__badgeLabel")?.style.removeProperty("visibility");
  });
  if (!enabled) {
    textEls.forEach((el) => el.style.removeProperty("-webkit-text-fill-color"));
    return;
  }
  textEls.forEach((el) => el.style.setProperty("-webkit-text-fill-color", "transparent"));
  hosts.forEach((h) => {
    if (h.classList.contains("ticketCard__badgeHost_multiplier")) {
      h.style.setProperty("background-image", "none");
      h.querySelector<HTMLElement>(".ticketCard__badgeLabel")?.style.setProperty("visibility", "hidden");
      return;
    }
    if (h.classList.contains("ticketCard__badgeHost_dab")) {
      h.style.setProperty("background-image", "none");
    }
  });
  root.append(buildTicketOverlay(root));
}
