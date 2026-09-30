/**
 * Full-ticket SnapDOM capture — ported from fix/restore-catalog-alignment Compare.
 * Content-box crop, DPR-2 text nudges, separate rotated multiplier composite.
 */

import { snapdom } from "@zumer/snapdom";

const SNAP_OPTS = {
  embedFonts: true,
  outerTransforms: true,
  outerShadows: false,
  backgroundColor: "transparent" as const,
  fast: true,
  cache: "disabled" as const,
  compress: false,
  scale: 1,
};

function nudgeHeaderText(root: HTMLElement, dy: number): void {
  const px = `translateY(${dy}px)`;
  for (const sel of [".ticketCard__win", ".ticketCard__id"]) {
    const el = root.querySelector<HTMLElement>(sel);
    if (el) el.style.transform = px;
  }
}

function nudgeNumberText(root: HTMLElement, dy: number): void {
  for (const cell of root.querySelectorAll(".ticketCard__cell")) {
    const text = [...cell.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    if (!text?.textContent) continue;
    const span = document.createElement("span");
    span.style.display = "inline-block";
    span.style.transform = `translateY(${dy}px)`;
    span.textContent = text.textContent;
    text.replaceWith(span);
  }
}

/** SnapDOM text raster vs native — applied on off-screen clones only. */
export function nudgeSnapText(root: HTMLElement, dpr: number): boolean {
  if (Math.abs(dpr - 2) > 0.01) return false;
  const cardH = parseFloat(
    getComputedStyle(root).getPropertyValue("--ticket-card-height"),
  );
  if (cardH === 39) {
    nudgeNumberText(root, 0.5);
    nudgeHeaderText(root, -0.5);
    root.style.setProperty("--ticket-sep-nudge-x", "-0.5px");
    root.style.setProperty("--ticket-sep-nudge-y", "-0.5px");
    return true;
  }
  if (cardH === 43) {
    nudgeHeaderText(root, 0.5);
    root.style.setProperty("--ticket-sep-nudge-x", "-0.5px");
    return true;
  }
  return false;
}

async function snapCardBox(el: HTMLElement, dpr: number): Promise<HTMLCanvasElement> {
  const shot = await snapdom(el, { ...SNAP_OPTS, dpr });
  const { contentX, contentY, w0, h0 } = shot.meta;
  return shot.toCanvas({
    crop: { x: contentX, y: contentY, width: w0, height: h0 },
  });
}

const MULTIPLIER_ROTATION = (-15 * Math.PI) / 180;

type DeviceBox = { x: number; y: number; w: number; h: number; cx: number; cy: number };

function deviceBox(
  box: DOMRect,
  root: DOMRect,
  bitmapW: number,
  bitmapH: number,
): DeviceBox {
  const rw = Math.max(root.width, 1);
  const rh = Math.max(root.height, 1);
  const sx = bitmapW / rw;
  const sy = bitmapH / rh;
  const x = (box.left - root.left) * sx;
  const y = (box.top - root.top) * sy;
  const w = Math.max(0, box.width * sx);
  const h = Math.max(0, box.height * sy);
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

/** Off-screen FO clones need explicit card size or label/deviceBox math collapses to 0. */
export function syncCaptureCloneLayout(live: HTMLElement, clone: HTMLElement): void {
  const w = live.offsetWidth;
  const h = live.offsetHeight;
  if (w > 0) clone.style.width = `${w}px`;
  if (h > 0) clone.style.height = `${h}px`;
  void clone.offsetWidth;
}

export function liveHasMultiplierBadge(live: HTMLElement): boolean {
  const label = live.querySelector<HTMLElement>(".ticketCard__multiplier");
  if (!label) return false;
  const r = label.getBoundingClientRect();
  return r.width > 0.5 && r.height > 0.5;
}

function blitRotatedMultiplierSprite(
  base: HTMLCanvasElement,
  sprite: HTMLCanvasElement,
  dest: DeviceBox,
  src: DeviceBox,
  cropX: number,
  cropY: number,
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = base.width;
  out.height = base.height;
  const ctx = out.getContext("2d");
  if (!ctx || base.width < 1 || base.height < 1) return base;
  ctx.drawImage(base, 0, 0);
  if (sprite.width < 1 || sprite.height < 1) return out;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(dest.cx, dest.cy);
  ctx.rotate(MULTIPLIER_ROTATION);
  ctx.translate(-(src.cx - cropX), -(src.cy - cropY));
  ctx.drawImage(sprite, 0, 0);
  ctx.restore();
  return out;
}

/**
 * Diff-matte needs getImageData — fails on tainted FO blob decodes.
 * Fall back to the flat crop only (label was hidden on `base`).
 */
function buildMultiplierSprite(
  base: HTMLCanvasElement,
  flat: HTMLCanvasElement,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  if (
    cropW < 1 ||
    cropH < 1 ||
    flat.width < 1 ||
    flat.height < 1 ||
    base.width < 1 ||
    base.height < 1
  ) {
    return sprite;
  }
  sprite.width = cropW;
  sprite.height = cropH;
  const sctx = sprite.getContext("2d");
  if (!sctx) return sprite;
  sctx.drawImage(flat, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  const bg = document.createElement("canvas");
  bg.width = cropW;
  bg.height = cropH;
  const bctx = bg.getContext("2d");
  if (!bctx) return sprite;
  bctx.drawImage(base, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  try {
    const img = sctx.getImageData(0, 0, cropW, cropH);
    const bimg = bctx.getImageData(0, 0, cropW, cropH);
    const data = img.data;
    const bd = bimg.data;
    for (let i = 0; i < data.length; i += 4) {
      const diff = Math.max(
        Math.abs(data[i]! - bd[i]!),
        Math.abs(data[i + 1]! - bd[i + 1]!),
        Math.abs(data[i + 2]! - bd[i + 2]!),
      );
      const alpha = Math.min(1, diff / 70);
      if (alpha < 0.06) {
        data[i + 3] = 0;
      } else {
        data[i] = Math.max(
          0,
          Math.min(255, Math.round((data[i]! - bd[i]! * (1 - alpha)) / alpha)),
        );
        data[i + 1] = Math.max(
          0,
          Math.min(255, Math.round((data[i + 1]! - bd[i + 1]! * (1 - alpha)) / alpha)),
        );
        data[i + 2] = Math.max(
          0,
          Math.min(255, Math.round((data[i + 2]! - bd[i + 2]! * (1 - alpha)) / alpha)),
        );
        data[i + 3] = Math.round(alpha * 255);
      }
    }
    sctx.putImageData(img, 0, 0);
  } catch {
    /* FO foreignObject → blob → canvas is cross-origin tainted */
  }
  return sprite;
}

/** FO / Snap full-ticket: composite unrotated label pixels at the live rotation. */
export function paintRotatedMultiplier(
  base: HTMLCanvasElement,
  flat: HTMLCanvasElement,
  flatRoot: HTMLElement,
  liveRoot: HTMLElement,
): HTMLCanvasElement {
  const flatLabel = flatRoot.querySelector<HTMLElement>(".ticketCard__multiplier");
  const liveLabel = liveRoot.querySelector<HTMLElement>(".ticketCard__multiplier");
  if (!flatLabel || !liveLabel) return base;
  if (base.width < 1 || base.height < 1 || flat.width < 1 || flat.height < 1) return base;

  syncCaptureCloneLayout(liveRoot, flatRoot);
  const liveRootBox = liveRoot.getBoundingClientRect();
  const flatRootBox = flatRoot.getBoundingClientRect();
  const flatRootForMap =
    flatRootBox.width > 0 && flatRootBox.height > 0 ? flatRootBox : liveRootBox;

  const src = deviceBox(
    flatLabel.getBoundingClientRect(),
    flatRootForMap,
    flat.width,
    flat.height,
  );
  const dest = deviceBox(
    liveLabel.getBoundingClientRect(),
    liveRootBox,
    base.width,
    base.height,
  );
  const fontPx = parseFloat(getComputedStyle(flatLabel).fontSize) || 13;
  const pad = Math.ceil(
    fontPx * 0.8 * (flat.width / Math.max(flatRootForMap.width, 1)),
  );
  const cropX = Math.floor(src.x - pad);
  const cropY = Math.floor(src.y - pad);
  const cropW = Math.ceil(src.w + pad * 2);
  const cropH = Math.ceil(src.h + pad * 2);
  if (cropW < 1 || cropH < 1 || !Number.isFinite(cropX) || !Number.isFinite(cropY)) {
    return base;
  }

  const sprite = buildMultiplierSprite(base, flat, cropX, cropY, cropW, cropH);
  return blitRotatedMultiplierSprite(base, sprite, dest, src, cropX, cropY);
}

export function captureSnapClone(live: HTMLElement): HTMLElement {
  const clone = live.cloneNode(true) as HTMLElement;
  clone.style.position = "fixed";
  clone.style.left = "-10000px";
  clone.style.top = "0";
  clone.style.transform = "none";
  clone.style.visibility = "visible";
  (live.closest(".compare") ?? document.body).appendChild(clone);
  return clone;
}

/** Snap the live ticket root; returns device-pixel bitmap sized to the card box. */
export async function snapFullCard(
  live: HTMLElement,
  dpr: number,
): Promise<{ bitmap: HTMLCanvasElement; nudged: boolean }> {
  const hidden = captureSnapClone(live);
  const flat = captureSnapClone(live);
  const nudged = nudgeSnapText(hidden, dpr);
  nudgeSnapText(flat, dpr);
  const hiddenLabel = hidden.querySelector<HTMLElement>(".ticketCard__multiplier");
  const flatLabel = flat.querySelector<HTMLElement>(".ticketCard__multiplier");
  if (hiddenLabel) hiddenLabel.style.visibility = "hidden";
  if (flatLabel) flatLabel.style.transform = "none";
  try {
    await snapCardBox(hidden, dpr);
    const base = await snapCardBox(hidden, dpr);
    await snapCardBox(flat, dpr);
    const flatBmp = await snapCardBox(flat, dpr);
    return { bitmap: paintRotatedMultiplier(base, flatBmp, flat, live), nudged };
  } finally {
    hidden.remove();
    flat.remove();
  }
}
