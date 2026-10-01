/**
 * /compare experiment: multiplier label as SVG text with explicit coordinates.
 *
 * HTML text is laid out twice on iPhone — once in the page, once inside the
 * raster's SVG image — and WebKit rounds its baselines differently there.
 * SVG `<text x y>` has no line box or ascent rounding, so the live DOM and the
 * raster clone paint the same glyph positions. Mirrors the three CSS layers
 * (shadow, gradient stroke, gradient fill) of `.ticketCard__multiplier`.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const ROTATION_DEG = -15;
const SUFFIX_SCALE = 0.769;
const SUFFIX_GAP_EM = 0.06;
const STROKE_EM = 0.13;
const SHADOW_DY_EM = 0.0556;
/** Optical centre: baseline offset from the badge centre, in em (Onest caps). */
const BASELINE_EM = 0.36;

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  ...children: SVGElement[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  node.append(...children);
  return node;
}

function gradients(): SVGDefsElement {
  const stop = (offset: string, color: string) => el("stop", { offset, "stop-color": color });
  return el(
    "defs",
    {},
    el(
      "linearGradient",
      { id: "cmpMultFill", x1: 0.456, y1: 0.002, x2: 0.544, y2: 0.998 },
      stop("0.495%", "#ffe27b"),
      stop("26.893%", "#ffffff"),
      stop("63.411%", "#ffda6c"),
      stop("78.509%", "#ffb200"),
    ),
    el(
      "linearGradient",
      { id: "cmpMultStroke", x1: 0, y1: 0, x2: 0, y2: 1 },
      stop("0", "rgb(128,26,28)"),
      stop("1", "rgb(63,9,10)"),
    ),
  );
}

function multiplierSvg(value: string, size: number, fontPx: number, disabled: boolean): SVGSVGElement {
  const c = size / 2;
  const layer = (fill: string, stroke: string | null, dy: number) => {
    const suffix = el("tspan", { "font-size": SUFFIX_SCALE * fontPx, dx: SUFFIX_GAP_EM * fontPx });
    suffix.textContent = "×";
    const digits = el("tspan", {});
    digits.textContent = value;
    const attrs: Record<string, string | number> = {
      x: c,
      y: c + BASELINE_EM * fontPx + dy,
      "text-anchor": "middle",
      "font-family": "MB-Onest, Onest, sans-serif",
      "font-weight": 700,
      "font-size": fontPx,
      "letter-spacing": -0.01 * fontPx,
      fill,
    };
    if (stroke) {
      Object.assign(attrs, {
        stroke,
        "stroke-width": STROKE_EM * fontPx,
        "stroke-linejoin": "round",
        "paint-order": "stroke fill",
      });
    }
    return el("text", attrs, digits, suffix);
  };
  const layers = disabled
    ? [layer("#053734", "#053734", SHADOW_DY_EM * fontPx), layer("#236260", null, 0)]
    : [
        layer("#210304", "#210304", SHADOW_DY_EM * fontPx),
        layer("url(#cmpMultStroke)", "url(#cmpMultStroke)", 0),
        layer("url(#cmpMultFill)", null, 0),
      ];
  const svg = el(
    "svg",
    {
      class: "ticketCard__multiplierSvg",
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      overflow: "visible",
      "aria-hidden": "true",
    },
    ...(disabled ? [] : [gradients()]),
    el("g", { transform: `rotate(${ROTATION_DEG} ${c} ${c})` }, ...layers),
  );
  return svg;
}

/**
 * Swap every multiplier label under `root` to (or back from) the SVG version.
 * The HTML label is hidden, not removed, so `TicketCard` updates keep working.
 */
export function applySvgMultiplier(root: HTMLElement, enabled: boolean): void {
  const disabled = root.classList.contains("ticketCard_disabled");
  root
    .querySelectorAll<HTMLElement>(".ticketCard__badgeHost_multiplier .ticketCard__badgeLabel")
    .forEach((label) => {
      const html = label.querySelector<HTMLElement>(".ticketCard__multiplier");
      const existing = label.querySelector<SVGSVGElement>(".ticketCard__multiplierSvg");
      if (!enabled) {
        existing?.remove();
        html?.style.removeProperty("display");
        return;
      }
      const value = html?.querySelector(".ticketCard__multiplierFill > span")?.textContent ?? "";
      const host = label.parentElement as HTMLElement;
      const size = parseFloat(host.style.width) || host.getBoundingClientRect().width;
      // From the card's own variable: computed styles are empty while detached.
      const dab = parseFloat(root.style.getPropertyValue("--ticket-dab-size")) || size;
      const fontPx = (13 * dab) / 24;
      const key = `${value}|${size}|${fontPx}|${disabled}`;
      if (existing?.dataset.key === key) return;
      existing?.remove();
      const svg = multiplierSvg(value, size, fontPx, disabled);
      svg.dataset.key = key;
      if (html) html.style.display = "none";
      label.append(svg);
    });
}
