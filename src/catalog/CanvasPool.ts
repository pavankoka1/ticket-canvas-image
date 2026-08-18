import { getTicketBitmap } from './bitmapCache';
import { CARD_HEIGHT, CARD_RADIUS, CARD_WIDTH, contentWidth } from './layout';
import type { TicketSlot } from './tickets';

/**
 * Single canvas underlay — one DOM node for the whole scroll path.
 * (Previously 400 `<canvas>` elements ≈ most of the node explosion.)
 */
export class CanvasPool {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private ready = false;
  private slots: TicketSlot[] = [];
  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.host.style.opacity = '1';
  }

  mount(): void {
    if (this.ready) return;
    const c = document.createElement('canvas');
    c.className = 'ticketCanvasLayer';
    c.style.position = 'absolute';
    c.style.left = '0';
    c.style.top = '0';
    c.style.pointerEvents = 'none';
    this.host.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext('2d');
    this.ready = true;
  }

  rebind(slots: readonly TicketSlot[], _forcePaint = false): void {
    if (!this.ready || !this.canvas || !this.ctx) return;
    this.slots = slots.slice();
    this.paint();
  }

  refreshFromCache(_ids?: readonly string[]): void {
    if (!this.ready) return;
    this.paint();
  }

  get boundCount(): number {
    return this.slots.length;
  }

  private paint(): void {
    const c = this.canvas;
    const ctx = this.ctx;
    if (!c || !ctx) return;

    if (this.slots.length === 0) {
      c.width = 0;
      c.height = 0;
      c.style.width = '0';
      c.style.height = '0';
      return;
    }

    let minY = Infinity;
    let maxY = -Infinity;
    for (const s of this.slots) {
      if (s.y < minY) minY = s.y;
      if (s.y + CARD_HEIGHT > maxY) maxY = s.y + CARD_HEIGHT;
    }

    const cssW = contentWidth();
    const cssH = Math.max(1, maxY - minY);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);

    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    c.style.width = `${cssW}px`;
    c.style.height = `${cssH}px`;
    c.style.transform = `translate3d(0, ${minY}px, 0)`;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    ctx.imageSmoothingEnabled = false;

    const r = CARD_RADIUS * dpr;
    const cw = Math.round(CARD_WIDTH * dpr);
    const ch = Math.round(CARD_HEIGHT * dpr);

    for (const slot of this.slots) {
      const bitmap = getTicketBitmap(slot.id);
      if (!bitmap) continue;
      const dx = Math.round(slot.x * dpr);
      const dy = Math.round((slot.y - minY) * dpr);
      ctx.save();
      roundRectPath(ctx, dx, dy, cw, ch, r);
      ctx.clip();
      ctx.drawImage(bitmap, dx, dy, cw, ch);
      ctx.restore();
    }
  }
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
