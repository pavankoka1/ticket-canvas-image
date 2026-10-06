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

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  ...children: SVGElement[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  node.append(...children);
  return node;
}

/** Gradient defs referenced by the gold label layers (ids are shared). */
export function multiplierDefs(): SVGDefsElement {
  const stop = (offset: string, color: string) => svgEl("stop", { offset, "stop-color": color });
  return svgEl(
    "defs",
    {},
    svgEl(
      "linearGradient",
      { id: "cmpMultFill", x1: 0.456, y1: 0.002, x2: 0.544, y2: 0.998 },
      stop("0.495%", "#ffe27b"),
      stop("26.893%", "#ffffff"),
      stop("63.411%", "#ffda6c"),
      stop("78.509%", "#ffb200"),
    ),
    svgEl(
      "linearGradient",
      { id: "cmpMultStroke", x1: 0, y1: 0, x2: 0, y2: 1 },
      stop("0", "rgb(128,26,28)"),
      stop("1", "rgb(63,9,10)"),
    ),
  );
}

const DISC_URLS = { normal: "/badge-circle.png", disabled: "/badge-circle-disabled.png" } as const;
const DAB_URLS = { normal: "/dab-full.png", disabled: "/dab-disabled.png" } as const;
const discData: Partial<Record<keyof typeof DISC_URLS, string>> = {};
const dabData: Partial<Record<keyof typeof DAB_URLS, string>> = {};
let discLoad: Promise<void> | null = null;

async function loadPngDataUrls(urls: Record<string, string>, into: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(urls).map(async ([k, url]) => {
      const blob = await (await fetch(url)).blob();
      into[k] = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error(url));
        reader.readAsDataURL(blob);
      });
    }),
  );
}

/**
 * Disc + dab PNGs as data URLs: overlay SVG and raster clones cannot fetch
 * files reliably. Await before the first svg-all capture.
 */
export function loadSvgMultiplierAssets(): Promise<void> {
  discLoad ??= Promise.all([
    loadPngDataUrls(DISC_URLS, discData as Record<string, string>),
    loadPngDataUrls(DAB_URLS, dabData as Record<string, string>),
  ]).then(() => undefined);
  return discLoad;
}

/** Data URL of the disc PNG, once `loadSvgMultiplierAssets` has resolved. */
export function discDataUrl(disabled: boolean): string | undefined {
  return discData[disabled ? "disabled" : "normal"];
}

/** Data URL of the dab PNG, once `loadSvgMultiplierAssets` has resolved. */
export function dabDataUrl(disabled: boolean): string | undefined {
  return dabData[disabled ? "disabled" : "normal"];
}

/** True once disc + dab PNGs are inlined for svg-all overlay `<image>` nodes. */
export function svgMultiplierAssetsReady(): boolean {
  return Boolean(
    dabDataUrl(false) && dabDataUrl(true) && discDataUrl(false) && discDataUrl(true),
  );
}

/** Rotated three-layer label centred on (cx, cy), in the caller's coordinates. */
export function multiplierGroup(value: string, cx: number, cy: number, fontPx: number, disabled: boolean): SVGGElement {
  const layer = (fill: string, stroke: string | null, dy: number) => {
    const suffix = svgEl("tspan", { "font-size": SUFFIX_SCALE * fontPx, dx: SUFFIX_GAP_EM * fontPx });
    suffix.textContent = "×";
    const digits = svgEl("tspan", {});
    digits.textContent = value;
    const attrs: Record<string, string | number> = {
      x: cx,
      y: cy + BASELINE_EM * fontPx + dy,
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
    return svgEl("text", attrs, digits, suffix);
  };
  const layers = disabled
    ? [layer("#053734", "#053734", SHADOW_DY_EM * fontPx), layer("#236260", null, 0)]
    : [
        layer("#210304", "#210304", SHADOW_DY_EM * fontPx),
        layer("url(#cmpMultStroke)", "url(#cmpMultStroke)", 0),
        layer("url(#cmpMultFill)", null, 0),
      ];
  return svgEl("g", { transform: `rotate(${ROTATION_DEG} ${cx} ${cy})` }, ...layers);
}

function multiplierSvg(
  value: string,
  size: number,
  fontPx: number,
  disabled: boolean,
  disc: string | undefined,
): SVGSVGElement {
  const c = size / 2;
  const svg = svgEl(
    "svg",
    {
      class: "ticketCard__multiplierSvg",
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      overflow: "visible",
      "aria-hidden": "true",
    },
    ...(disabled ? [] : [multiplierDefs()]),
    // Disc at explicit coordinates: no CSS background-size resampling of a
    // fractional host box.
    ...(disc ? [svgEl("image", { href: disc, x: 0, y: 0, width: size, height: size, preserveAspectRatio: "none" })] : []),
    multiplierGroup(value, c, c, fontPx, disabled),
  );
  return svg;
}

/**
 * Swap every multiplier label under `root` to (or back from) the SVG version.
 * The HTML label is hidden, not removed, so `TicketCard` updates keep working.
 */
export function applySvgMultiplier(root: HTMLElement, enabled: boolean, withDisc = false): void {
  const disabled = root.classList.contains("ticketCard_disabled");
  root
    .querySelectorAll<HTMLElement>(".ticketCard__badgeHost_multiplier .ticketCard__badgeLabel")
    .forEach((label) => {
      const html = label.querySelector<HTMLElement>(".ticketCard__multiplier");
      const existing = label.querySelector<SVGSVGElement>(".ticketCard__multiplierSvg");
      const host = label.parentElement as HTMLElement;
      if (!enabled) {
        existing?.remove();
        html?.style.removeProperty("display");
        host.style.removeProperty("background-image");
        return;
      }
      const value = html?.querySelector(".ticketCard__multiplierFill > span")?.textContent ?? "";
      const size = parseFloat(host.style.width) || host.getBoundingClientRect().width;
      // From the card's own variable: computed styles are empty while detached.
      const dab = parseFloat(root.style.getPropertyValue("--ticket-dab-size")) || size;
      const fontPx = (13 * dab) / 24;
      const disc = withDisc ? discData[disabled ? "disabled" : "normal"] : undefined;
      if (disc) host.style.setProperty("background-image", "none");
      else host.style.removeProperty("background-image");
      const key = `${value}|${size}|${fontPx}|${disabled}|${disc ? "disc" : "css-disc"}`;
      if (existing?.dataset.key === key) return;
      existing?.remove();
      const svg = multiplierSvg(value, size, fontPx, disabled, disc);
      svg.dataset.key = key;
      if (html) html.style.display = "none";
      label.append(svg);
    });
}
