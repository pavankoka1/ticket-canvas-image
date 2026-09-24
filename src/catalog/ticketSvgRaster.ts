/**
 * Rasterize the live ticket by embedding that DOM, with computed styles
 * and the font inlined, in an SVG foreignObject. The image is then decoded
 * and blitted to a canvas. Unlike an SVG <text> redraw, the browser's HTML
 * painter produces the pixels, including the rotated multiplier.
 */

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
        return `@font-face{font-family:'MB-Onest';font-style:normal;font-weight:700;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
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

export async function rasterizeTicketSvg(
  card: HTMLElement,
  dpr: number,
  padCss = 0,
): Promise<HTMLCanvasElement> {
  const rect = card.getBoundingClientRect();
  const cssW = rect.width + padCss * 2;
  const cssH = rect.height + padCss * 2;
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);

  // Blob SVG images cannot load page URLs. Every badge the clone may
  // reference has to be inlined, including the green-ticket discs. Those
  // two were missing, so a disabled dab/multiplier raster was empty and the
  // original number showed through.
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

  const clone = card.cloneNode(true) as HTMLElement;
  inlineTree(card, clone, images);
  clone.style.position = "absolute";
  // Computed `inset` / `left` can be the off-screen capture offset. Reset
  // those before placing the clone, or the face paints outside the bitmap.
  clone.style.inset = "auto";
  clone.style.left = `${padCss}px`;
  clone.style.top = `${padCss}px`;
  clone.style.right = "auto";
  clone.style.bottom = "auto";
  clone.style.transform = "none";
  clone.style.margin = "0";
  // Pad grows the foreignObject, not the element. Stretching the badge to
  // the padded box recenters the rotated label and clips it.
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  if (padCss > 0) clone.style.overflow = "visible";

  // viewBox is device pixels, and zoom paints the HTML at that resolution,
  // so the SVG image is not scaled a second time on the way to the canvas.
  // position:relative is the containing block for a padded absolute clone.
  const holder =
    padCss > 0
      ? `position:relative;overflow:visible;margin:0;padding:0;width:${cssW}px;height:${cssH}px;zoom:${dpr}`
      : `margin:0;padding:0;width:${cssW}px;height:${cssH}px;zoom:${dpr}`;
  const xhtml =
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${holder}">` +
    `<style>${fontCss}</style>` +
    clone.outerHTML +
    `</div>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" viewBox="0 0 ${bw} ${bh}">` +
    `<foreignObject x="0" y="0" width="${bw}" height="${bh}">${xhtml}</foreignObject>` +
    `</svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
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

/** SVG bytes for a raster, so the bitmap can be stored without reading pixels. */
const rasterSvgBlobs = new WeakMap<HTMLCanvasElement, Blob>();

export function rasterSvgBlob(canvas: HTMLCanvasElement): Blob | undefined {
  return rasterSvgBlobs.get(canvas);
}
