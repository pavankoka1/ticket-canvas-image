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

import { discDataUrl, multiplierDefs, multiplierGroup, svgEl } from "./compareSvgMultiplier";

/** Baseline below the box centre, in em (Onest cap height ≈ 0.72 em). */
const BASELINE_EM = 0.36;
const FONT = "MB-Onest, Onest, sans-serif";
export const OVERLAY_CLASS = "ticketCard__svgOverlay";
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
  const padY = px(root, "--ticket-body-padding-y");
  const sep = px(root, "--ticket-separator-width");
  const metaPx = px(root, "--ticket-meta-font-size");
  const numberPx = px(root, "--ticket-number-font-size");
  const dab = px(root, "--ticket-dab-size");

  const children: SVGElement[] = [];
  const headerY = headerH / 2 + BASELINE_EM * metaPx;
  const id = textOf(root.querySelector(".ticketCard__id"));
  const amount = textOf(root.querySelector(".ticketCard__win"));
  if (id) children.push(text(id, W - padX, headerY, "end", metaPx, COLORS.id[face], true));
  if (amount) children.push(text(amount, padX, headerY, "start", metaPx, COLORS.amount[face], true));

  let needsDefs = false;
  root.querySelectorAll<HTMLElement>(".ticketCard__cell").forEach((cell, i) => {
    const cellW = parseFloat(cell.style.width);
    const cellH = parseFloat(cell.style.height);
    const x0 = i * (cellW + sep);
    const y0 = headerH + padY;
    const value = textOf(cell);
    if (value) {
      children.push(text(value, x0 + cellW / 2, y0 + cellH / 2 + BASELINE_EM * numberPx, "middle", numberPx, COLORS.number[face]));
    }
    const host = cell.querySelector<HTMLElement>(".ticketCard__badgeHost_multiplier");
    if (!host || host.style.display === "none") return;
    const label = host.querySelector(".ticketCard__multiplierFill > span")?.textContent ?? "";
    const size = parseFloat(host.style.width);
    const hx = x0 + parseFloat(host.style.left);
    const hy = y0 + parseFloat(host.style.top);
    const disc = discDataUrl(face === "disabled");
    if (disc) children.push(svgEl("image", { href: disc, x: hx, y: hy, width: size, height: size, preserveAspectRatio: "none" }));
    children.push(multiplierGroup(label, hx + size / 2, hy + size / 2, (13 * dab) / 24, face === "disabled"));
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

/** Swap header, cell and multiplier rendering under `root` to (or back from) the overlay. */
export function applySvgText(root: HTMLElement, enabled: boolean): void {
  root.querySelector(`:scope > .${OVERLAY_CLASS}`)?.remove();
  const textEls = root.querySelectorAll<HTMLElement>(".ticketCard__id, .ticketCard__win, .ticketCard__cell");
  // Hosts are reused (dab ↔ multiplier), so every host is reset first.
  const hosts = root.querySelectorAll<HTMLElement>(".ticketCard__badgeHost");
  hosts.forEach((h) => {
    h.style.removeProperty("background-image");
    h.querySelector<HTMLElement>(".ticketCard__badgeLabel")?.style.removeProperty("visibility");
  });
  if (!enabled) {
    textEls.forEach((el) => el.style.removeProperty("-webkit-text-fill-color"));
    return;
  }
  textEls.forEach((el) => el.style.setProperty("-webkit-text-fill-color", "transparent"));
  hosts.forEach((h) => {
    if (!h.classList.contains("ticketCard__badgeHost_multiplier")) return;
    h.style.setProperty("background-image", "none");
    h.querySelector<HTMLElement>(".ticketCard__badgeLabel")?.style.setProperty("visibility", "hidden");
  });
  root.append(buildTicketOverlay(root));
}
