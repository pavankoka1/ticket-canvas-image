import type { BitmapSprite } from "./cellBitmaps";

export type InkBBox2D = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function scanInkBBox2D(canvas: HTMLCanvasElement): InkBBox2D | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return null;
  }
  const w = canvas.width;
  const h = canvas.height;
  let left = w;
  let right = -1;
  let top = h;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3]! / 255;
      if (a < 0.02) continue;
      const r = data[i]! * a + 255 * (1 - a);
      const g = data[i + 1]! * a + 255 * (1 - a);
      const b = data[i + 2]! * a + 255 * (1 - a);
      if (r < 200 || g < 200 || b < 200) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < left || bottom < top) return null;
  return { left, top, right, bottom };
}

function inkFromCanvas(canvas: HTMLCanvasElement): InkBBox2D {
  return scanInkBBox2D(canvas) ?? { left: 0, top: 0, right: canvas.width - 1, bottom: canvas.height - 1 };
}

/** Ink top-left in sprite device pixels (for aligning DOM text ink to SVG capture). */
export function spriteInkTopLeft(sprite: BitmapSprite): { left: number; top: number } {
  if (sprite instanceof HTMLCanvasElement) {
    const ink = inkFromCanvas(sprite);
    return { left: ink.left, top: ink.top };
  }
  const c = document.createElement("canvas");
  c.width = sprite.width;
  c.height = sprite.height;
  const ctx = c.getContext("2d");
  if (!ctx) return { left: 0, top: 0 };
  ctx.drawImage(sprite, 0, 0);
  const ink = inkFromCanvas(c);
  return { left: ink.left, top: ink.top };
}
