/**
 * Rasterize the live ticket by embedding that DOM, with computed styles
 * and the font inlined, in an SVG foreignObject. The image is then decoded
 * and blitted to a canvas. Unlike an SVG <text> redraw, the browser's HTML
 * painter produces the pixels, including the rotated multiplier.
 */

import { nudgeSnapText } from "./fullTicketSnap";
import { ensureTicketFontsForLayout } from "./ticketFont";
import type { TicketMetrics } from "./ticketPresets";

const FONT_URL = "/fonts/onest-700.woff2";

let fontFacePromise: Promise<string> | null = null;
const imagePromises = new Map<string, Promise<string>>();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fontFaceCss(): Promise<string> {
  if (!fontFacePromise) {
    fontFacePromise = fetch(FONT_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`font ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => {
        const b64 = bytesToBase64(new Uint8Array(buf));
        const src = `url(data:font/woff2;base64,${b64}) format('woff2')`;
        return (
          `@font-face{font-family:'MB-Onest';font-style:normal;font-weight:700;src:${src};}` +
          `@font-face{font-family:Onest;font-style:normal;font-weight:700;src:${src};}`
        );
      });
  }
  return fontFacePromise;
}

function imageDataUrl(url: string): Promise<string> {
  let pending = imagePromises.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`${url} ${res.status}`);
        return res.blob();
      })
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error ?? new Error(url));
            reader.readAsDataURL(blob);
          }),
      );
    imagePromises.set(url, pending);
  }
  return pending;
}

function rewriteUrls(value: string, images: Map<string, string>): string {
  return value.replace(/url\((['"]?)([^'")]+)\1\)/g, (full, _q, raw: string) => {
    const hit = images.get(raw) ?? images.get(raw.replace(/^.*\//, "/"));
    return hit ? `url("${hit}")` : full;
  });
}

function applyComputedStyle(
  src: Element,
  dst: HTMLElement,
  images: Map<string, string>,
  pseudo = false,
): void {
  const cs = pseudo ? getComputedStyle(src, "::before") : getComputedStyle(src);
  dst.style.cssText = "";
  for (let i = 0; i < cs.length; i++) {
    const prop = cs.item(i);
    let value = cs.getPropertyValue(prop);
    if (value.includes("url(")) value = rewriteUrls(value, images);
    dst.style.setProperty(prop, value);
  }
}

function firstInkTextNode(root: HTMLElement): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    if (t.data.trim()) return t;
  }
  return null;
}

/** Live DOM ink vertical centre from the element top, device px (Range — same as Compare). */
function domInkCentreYDevice(el: HTMLElement, dpr: number): number | null {
  const node = firstInkTextNode(el);
  if (!node) return null;
  const range = document.createRange();
  range.selectNodeContents(node);
  const inkR = range.getBoundingClientRect();
  const boxR = el.getBoundingClientRect();
  if (inkR.height <= 0) return null;
  const centreCss = inkR.top - boxR.top + inkR.height / 2;
  return centreCss * dpr;
}

function cellHasInkText(el: HTMLElement): boolean {
  return [...el.childNodes].some(
    (n) => n.nodeType === Node.TEXT_NODE && (n as Text).data.trim(),
  );
}

const svgRasterInkShiftDevice = new Map<string, number>();

export function clearSvgRasterInkShiftCache(): void {
  svgRasterInkShiftDevice.clear();
}

/**
 * Mechanism B: blob-SVG foreignObject paints digit ink higher than native DOM.
 * Calibrate on the same SVG path used for whole-ticket paint (warm discard included).
 */
function svgRasterInkShiftKey(
  metrics: TicketMetrics,
  dpr: number,
  probeCell: HTMLElement,
): string {
  const r = probeCell.getBoundingClientRect();
  return `${metrics.id}|${dpr}|${Math.round(r.width)}x${Math.round(r.height)}`;
}

let foInkProbeHost: HTMLDivElement | null = null;

function foreignObjectInkProbeHost(): HTMLDivElement {
  if (!foInkProbeHost) {
    foInkProbeHost = document.createElement("div");
    foInkProbeHost.className = "catalog__captureHost";
    foInkProbeHost.setAttribute("aria-hidden", "true");
    foInkProbeHost.style.cssText =
      "position:fixed;left:0;top:0;opacity:0.001;pointer-events:none;z-index:-1;overflow:hidden";
    document.body.appendChild(foInkProbeHost);
  }
  return foInkProbeHost;
}

/**
 * Measure digit ink centre inside an on-page SVG foreignObject (same markup as blob raster).
 * Avoids tainted canvas getImageData after blob decode.
 */
function measureForeignObjectInkCentreYDevice(
  liveCell: HTMLElement,
  dpr: number,
  assets: RasterAssets,
  inkShiftCss: number,
): number | null {
  void liveCell.offsetWidth;
  const rect = liveCell.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  const cssW = rect.width;
  const cssH = rect.height;
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);

  const clone = liveCell.cloneNode(true) as HTMLElement;
  inlineTree(liveCell, clone, assets.images);
  clone.style.position = "absolute";
  clone.style.inset = "auto";
  clone.style.left = "0";
  clone.style.top = "0";
  clone.style.transform = "none";
  clone.style.margin = "0";
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  applySvgRasterInkNudge(clone, inkShiftCss);

  const holder = `position:relative;margin:0;padding:0;width:${cssW}px;height:${cssH}px;zoom:${dpr}`;
  const xhtml =
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${holder}">` +
    `<style>${assets.fontCss}</style>` +
    clone.outerHTML +
    `</div>`;

  const host = foreignObjectInkProbeHost();
  host.replaceChildren();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(bw));
  svg.setAttribute("height", String(bh));
  svg.setAttribute("viewBox", `0 0 ${bw} ${bh}`);
  const fo = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
  fo.setAttribute("x", "0");
  fo.setAttribute("y", "0");
  fo.setAttribute("width", String(bw));
  fo.setAttribute("height", String(bh));
  const parsed = new DOMParser().parseFromString(xhtml, "application/xml");
  const xdiv = parsed.documentElement;
  fo.appendChild(document.importNode(xdiv, true));
  svg.appendChild(fo);
  host.appendChild(svg);
  void host.offsetWidth;

  const rendered =
    host.querySelector<HTMLElement>(".ticketCard__cell") ??
    (clone.classList.contains("ticketCard__cell") ? host.querySelector(clone.tagName) : null);
  if (!rendered) return null;
  return domInkCentreYDevice(rendered, dpr);
}

async function resolveSvgRasterInkShiftDevice(
  probeCell: HTMLElement,
  dpr: number,
  metrics: TicketMetrics,
  assets: RasterAssets,
): Promise<number> {
  const key = svgRasterInkShiftKey(metrics, dpr, probeCell);
  const cached = svgRasterInkShiftDevice.get(key);
  if (cached !== undefined) return cached;

  const native = domInkCentreYDevice(probeCell, dpr);
  await document.fonts.ready;
  measureForeignObjectInkCentreYDevice(probeCell, dpr, assets, 0);
  const foCenter = measureForeignObjectInkCentreYDevice(probeCell, dpr, assets, 0);
  const shift = native != null && foCenter != null ? native - foCenter : 0;
  svgRasterInkShiftDevice.set(key, shift);
  console.log("[svgRaster] ink shiftY (device px)", {
    layout: metrics.id,
    dpr,
    shift: +shift.toFixed(2),
    foCenter: foCenter == null ? "n/a" : +foCenter.toFixed(2),
    nativeCenter: native == null ? "n/a" : +native.toFixed(2),
  });
  return shift;
}

function appendTranslateNudge(el: HTMLElement, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const prev = el.style.transform;
  const base = prev && prev !== "none" ? `${prev} ` : "";
  el.style.transform = `${base}translate(${dx}px, ${dy}px)`;
}

/** Isolated cell / header glyph capture — Y only, after transform reset. */
function applySvgRasterInkNudge(root: HTMLElement, inkShiftCss: number): void {
  appendTranslateNudge(root, 0, inkShiftCss);
}

function prepareRasterCloneBox(
  clone: HTMLElement,
  rect: DOMRect,
  padX: number,
  padY: number,
): { cssW: number; cssH: number } {
  clone.style.position = "absolute";
  clone.style.inset = "auto";
  clone.style.left = `${padX}px`;
  clone.style.top = `${padY}px`;
  clone.style.right = "auto";
  clone.style.bottom = "auto";
  clone.style.transform = "none";
  clone.style.margin = "0";
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  if (padX > 0 || padY > 0) clone.style.overflow = "visible";
  return { cssW: rect.width + padX * 2, cssH: rect.height + padY * 2 };
}

function buildFullTicketRasterClone(
  live: HTMLElement,
  assets: RasterAssets,
  rect: DOMRect,
  padX: number,
  padY: number,
  dpr: number,
): HTMLElement {
  const clone = live.cloneNode(true) as HTMLElement;
  inlineTree(live, clone, assets.images);
  prepareRasterCloneBox(clone, rect, padX, padY);
  nudgeSnapText(clone, dpr);
  return clone;
}

async function encodePreparedCloneForeignObject(
  clone: HTMLElement,
  dpr: number,
  padX: number,
  padY: number,
  rect: DOMRect,
  assets: RasterAssets,
): Promise<HTMLCanvasElement> {
  const cssW = rect.width + padX * 2;
  const cssH = rect.height + padY * 2;
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  const holderOverflow = padX > 0 || padY > 0 ? "overflow:visible;" : "";
  const holderStyle =
    `position:relative;${holderOverflow}margin:0;padding:0;width:${cssW}px;height:${cssH}px;zoom:${dpr}`;

  const xhtmlRoot = document.createElement("div");
  xhtmlRoot.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  xhtmlRoot.style.cssText = holderStyle;
  const styleEl = document.createElement("style");
  styleEl.textContent = assets.fontCss;
  xhtmlRoot.append(styleEl, clone);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(bw));
  svg.setAttribute("height", String(bh));
  svg.setAttribute("viewBox", `0 0 ${bw} ${bh}`);
  const fo = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
  fo.setAttribute("x", "0");
  fo.setAttribute("y", "0");
  fo.setAttribute("width", String(bw));
  fo.setAttribute("height", String(bh));
  fo.appendChild(document.importNode(xhtmlRoot, true));
  svg.appendChild(fo);

  const svgMarkup = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  let canvasOut: HTMLCanvasElement | null = null;
  try {
    const img = new Image();
    img.decoding = "sync";
    img.src = url;
    try {
      await img.decode();
    } catch {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("svg raster failed"));
      });
    }
    const canvas = document.createElement("canvas");
    canvas.width = bw;
    canvas.height = bh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, bw, bh);
    canvasOut = canvas;
    return canvas;
  } finally {
    if (canvasOut) rasterSvgBlobs.set(canvasOut, blob);
    URL.revokeObjectURL(url);
  }
}

async function rasterizeFullTicketForeignObject(
  live: HTMLElement,
  dpr: number,
  padX: number,
  padY: number,
  assets: RasterAssets,
  rect: DOMRect,
): Promise<HTMLCanvasElement> {
  const clone = buildFullTicketRasterClone(live, assets, rect, padX, padY, dpr);
  return encodePreparedCloneForeignObject(clone, dpr, padX, padY, rect, assets);
}

type RasterAssets = {
  fontCss: string;
  images: Map<string, string>;
};

async function loadRasterAssets(): Promise<RasterAssets> {
  const [fontCss, dabUrl, discUrl, dabOffUrl, discOffUrl] = await Promise.all([
    fontFaceCss(),
    imageDataUrl("/dab-full.png"),
    imageDataUrl("/badge-circle.png"),
    imageDataUrl("/dab-disabled.png"),
    imageDataUrl("/badge-circle-disabled.png"),
  ]);
  const images = new Map<string, string>([
    ["/dab-full.png", dabUrl],
    ["/badge-circle.png", discUrl],
    ["/dab-disabled.png", dabOffUrl],
    ["/badge-circle-disabled.png", discOffUrl],
  ]);
  for (const [path, data] of [...images]) {
    images.set(`${location.origin}${path}`, data);
  }
  return { fontCss, images };
}

type RasterizeOpts = {
  stabilize?: boolean;
  metrics?: TicketMetrics;
  liveRoot?: HTMLElement;
  /** Device px; 0 during ink calibration passes. */
  inkShiftDevice?: number;
  skipInkCalibration?: boolean;
};

async function rasterizeHtmlToCanvas(
  card: HTMLElement,
  dpr: number,
  pad: SvgRasterPad,
  assets: RasterAssets,
  opts: RasterizeOpts,
): Promise<HTMLCanvasElement> {
  const stabilize = opts.stabilize !== false;
  const { x: padX, y: padY } = resolveRasterPad(pad);
  void card.offsetWidth;
  const rect = card.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    throw new Error(
      `svg raster: ticket box ${rect.width.toFixed(2)}×${rect.height.toFixed(2)} — layout not ready`,
    );
  }
  const liveRoot = opts.liveRoot ?? card;
  const isFullTicket = card.classList.contains("ticketCard");

  if (isFullTicket && stabilize) {
    return rasterizeFullTicketForeignObject(
      liveRoot,
      dpr,
      padX,
      padY,
      assets,
      rect,
    );
  }

  const clone = card.cloneNode(true) as HTMLElement;
  inlineTree(card, clone, assets.images);
  prepareRasterCloneBox(clone, rect, padX, padY);

  if (
    stabilize &&
    opts.metrics &&
    !opts.skipInkCalibration &&
    !isFullTicket
  ) {
    let inkShiftDevice = opts.inkShiftDevice;
    if (inkShiftDevice === undefined) {
      const probe =
        [...liveRoot.querySelectorAll<HTMLElement>(".ticketCard__cell")].find((c) =>
          cellHasInkText(c),
        ) ??
        (liveRoot.classList.contains("ticketCard__cell") ? liveRoot : null);
      inkShiftDevice = probe
        ? await resolveSvgRasterInkShiftDevice(probe, dpr, opts.metrics, assets)
        : 0;
    }
    applySvgRasterInkNudge(clone, (inkShiftDevice ?? 0) / dpr);
  }

  return encodePreparedCloneForeignObject(clone, dpr, padX, padY, rect, assets);
}

function inlineTree(src: Element, dst: HTMLElement, images: Map<string, string>): void {
  applyComputedStyle(src, dst, images);
  const srcKids = [...src.children];
  const dstKids = [...dst.children];
  for (let i = 0; i < srcKids.length; i++) {
    const child = dstKids[i];
    if (child instanceof HTMLElement) inlineTree(srcKids[i]!, child, images);
  }
  const before = getComputedStyle(src, "::before");
  const content = before.content;
  if (content === "none" || content === "normal") return;
  if (parseFloat(before.width) <= 0 || parseFloat(before.height) <= 0) return;
  const span = document.createElement("span");
  applyComputedStyle(src, span, images, true);
  span.style.content = "none";
  dst.appendChild(span);
}

export type SvgRasterPad = number | { x?: number; y?: number };

function resolveRasterPad(pad: SvgRasterPad): { x: number; y: number } {
  if (typeof pad === "number") return { x: pad, y: pad };
  const x = pad.x ?? 0;
  return { x, y: pad.y ?? x };
}

/** Minimal FO probe (e.g. 50×50 digit) — no ticket ink calibration. */
export async function rasterizeElementSvg(
  el: HTMLElement,
  dpr: number,
): Promise<HTMLCanvasElement> {
  const assets = await loadRasterAssets();
  return rasterizeHtmlToCanvas(el, dpr, 0, assets, {
    stabilize: false,
    liveRoot: el,
  });
}

export async function rasterizeTicketSvg(
  card: HTMLElement,
  dpr: number,
  pad: SvgRasterPad = 0,
  metrics?: TicketMetrics,
): Promise<HTMLCanvasElement> {
  if (metrics) await ensureTicketFontsForLayout(metrics);
  const assets = await loadRasterAssets();
  return rasterizeHtmlToCanvas(card, dpr, pad, assets, {
    stabilize: true,
    metrics,
    liveRoot: card,
  });
}

/** SVG bytes for a raster, so the bitmap can be stored without reading pixels. */
const rasterSvgBlobs = new WeakMap<HTMLCanvasElement, Blob>();

export function rasterSvgBlob(canvas: HTMLCanvasElement): Blob | undefined {
  return rasterSvgBlobs.get(canvas);
}

/** IDB sprite bytes — PNG when `toBlob` works, else the captured SVG pack. */
export async function packBlobFromRasterCanvas(
  canvas: HTMLCanvasElement,
): Promise<Blob> {
  const svg = rasterSvgBlob(canvas);
  if (!svg) throw new Error("missing raster svg sidecar");
  const png = await svgBlobToPngBlob(svg);
  return png ?? svg;
}

/** Untainted PNG for atlas IDB — prefers captured SVG bytes, else canvas encode. */
export async function bitmapSpriteToPngBlob(
  sprite: HTMLCanvasElement | ImageBitmap,
): Promise<Blob> {
  if (sprite instanceof ImageBitmap) {
    const canvas = document.createElement("canvas");
    canvas.width = sprite.width;
    canvas.height = sprite.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, 0, 0);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!png) throw new Error("png encode failed");
    return png;
  }
  const svg = rasterSvgBlob(sprite);
  if (svg) {
    const png = await svgBlobToPngBlob(svg);
    if (png) return png;
    return svg;
  }
  const png = await new Promise<Blob | null>((resolve) =>
    sprite.toBlob(resolve, "image/png"),
  );
  if (!png) throw new Error("png encode failed");
  return png;
}

function isSvgBlob(blob: Blob): boolean {
  const t = blob.type;
  return t.includes("svg") || t.includes("xml");
}

/** Image + decode — reliable for our foreignObject SVG packs (createImageBitmap often fails). */
export async function decodeSvgBlobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "sync";
    img.src = url;
    try {
      await img.decode();
    } catch {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("svg blob decode failed"));
      });
    }
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Hydrate a stored atlas blob for canvas paint (SVG → canvas; PNG → ImageBitmap). */
export async function decodeStoredSpriteBlob(
  blob: Blob,
): Promise<HTMLCanvasElement | ImageBitmap> {
  if (isSvgBlob(blob)) return decodeSvgBlobToCanvas(blob);
  try {
    return await createImageBitmap(blob);
  } catch {
    return decodeSvgBlobToCanvas(blob);
  }
}

/** Untainted PNG for IDB — from the captured SVG pack bytes; null keeps SVG in IDB. */
export async function svgBlobToPngBlob(svg: Blob): Promise<Blob | null> {
  const canvas = await decodeSvgBlobToCanvas(svg);
  let png: Blob | null = null;
  try {
    png = await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob(resolve, "image/png");
      } catch {
        resolve(null);
      }
    });
  } catch {
    png = null;
  }
  return png;
}
