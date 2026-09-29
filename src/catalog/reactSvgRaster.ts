/**
 * React SVG → cached canvas bitmaps (https://svg-to-canvas.vercel.app/).
 * Native <svg> markup only — not HTML foreignObject.
 */

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const fontPromises = new Map<string, Promise<string>>();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function loadFontDataUrl(fontUrl: string): Promise<string> {
  let pending = fontPromises.get(fontUrl);
  if (!pending) {
    pending = fetch(fontUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`font ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => {
        const b64 = bytesToBase64(new Uint8Array(buf));
        return `data:font/woff2;base64,${b64}`;
      });
    fontPromises.set(fontUrl, pending);
  }
  return pending;
}

export type ReactSvgRasterStyle = {
  /** Injected after @font-face rules inside <svg><style>. */
  css: string;
  fontFaceCss?: string;
};

/** Splice width/height and a <style> block into serialized SVG. */
export function inlineSvgStyles(
  svgMarkup: string,
  pxW: number,
  pxH: number,
  style: ReactSvgRasterStyle,
): string {
  const block = `<style>${style.fontFaceCss ?? ""}${style.css}</style>`;
  return svgMarkup.replace(/<svg([^>]*)>/, (_, attrs: string) => {
    const hasW = /\bwidth=/.test(attrs);
    const hasH = /\bheight=/.test(attrs);
    const w = hasW ? "" : ` width="${pxW}"`;
    const h = hasH ? "" : ` height="${pxH}"`;
    return `<svg${attrs}${w}${h}>${block}`;
  });
}

export async function rasterizeSvgString(
  svg: string,
  pxW: number,
  pxH: number,
): Promise<HTMLCanvasElement> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  img.decoding = "sync";
  img.src = url;
  try {
    await img.decode();
  } catch {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("svg decode failed"));
    });
  }
  const canvas = document.createElement("canvas");
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, pxW, pxH);
  return canvas;
}

const canvasCache = new Map<string, HTMLCanvasElement | Promise<HTMLCanvasElement>>();

export function clearReactSvgRasterCache(): void {
  canvasCache.clear();
}

export type RasterizeReactSvgOpts = {
  cacheKey: string;
  pxW: number;
  pxH: number;
  element: ReactElement;
  style: ReactSvgRasterStyle;
};

/** Serialize a React SVG tree, inline fonts/CSS, decode once per cacheKey. */
export async function rasterizeReactSvg(
  opts: RasterizeReactSvgOpts,
): Promise<HTMLCanvasElement> {
  const hit = canvasCache.get(opts.cacheKey);
  if (hit) return hit instanceof Promise ? hit : hit;

  const pending = (async () => {
    const raw = renderToStaticMarkup(opts.element);
    const styled = inlineSvgStyles(raw, opts.pxW, opts.pxH, opts.style);
    return rasterizeSvgString(styled, opts.pxW, opts.pxH);
  })();

  canvasCache.set(opts.cacheKey, pending);
  try {
    const canvas = await pending;
    canvasCache.set(opts.cacheKey, canvas);
    return canvas;
  } catch (err) {
    canvasCache.delete(opts.cacheKey);
    throw err;
  }
}
