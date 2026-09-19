import { getDabImage, getDiscImage, getMultiplierLabel } from "./badgeAtlas";
import { contentWidth, getActiveLayout } from "./catalogLayout";
import { getCellBitmap, getTicketGeometry } from "./cellAtlas";
import { getLiveCellBoxModel, resolveCellBoxModel } from "./cellBoxModel";
import { BALLS_PER_TICKET, CANVAS_TILE_TICKETS } from "./layout";
import { isWinTicket, type Ticket, type TicketSlot } from "./tickets";

type Tile = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Inclusive start index into slots. */
  start: number;
  /** Exclusive end index. */
  end: number;
  minY: number;
  cssH: number;
  dirty: boolean;
};

/**
 * Full-catalog canvas underlay as tiles (≈150 tickets each).
 * Scroll never blanks — every ticket is already painted on some tile.
 */
export class CanvasPool {
  private tiles: Tile[] = [];
  private ready = false;
  private slots: TicketSlot[] = [];
  private ticketsById: Map<string, Ticket> = new Map();
  private readonly host: HTMLElement;
  private paintGen = 0;
  private paused = false;

  constructor(host: HTMLElement) {
    this.host = host;
    this.host.style.opacity = "1";
    this.host.style.visibility = "visible";
  }

  mount(): void {
    this.ready = true;
  }

  /**
   * Suspend tile painting during scroll. The tiles are a static underlay that
   * already covers the whole catalog, so they need no repaint while scrolling —
   * and a repaint triggered mid-scroll (atlas warm, badge load, data change)
   * would interleave heavy paints with scroll and halt it. Dirty tiles stay
   * dirty and flush on resume().
   */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    void this.paintDirtyTiles();
  }

  get isReady(): boolean {
    return this.ready;
  }

  get boundCount(): number {
    return this.slots.length;
  }

  get tileCount(): number {
    return this.tiles.length;
  }

  /**
   * Ensure tiles cover every slot and paint dirty ones.
   * Call when the ticket list / layout changes — not on every scroll.
   */
  setCatalog(
    slots: readonly TicketSlot[],
    ticketsById: Map<string, Ticket>,
  ): void {
    if (!this.ready) return;
    this.slots = slots.slice();
    this.ticketsById = ticketsById;
    this.syncTiles();
    void this.paintDirtyTiles();
  }

  /** Atlas sprites arrived — mark all dirty and repaint. */
  refresh(): void {
    if (!this.ready) return;
    for (const t of this.tiles) t.dirty = true;
    void this.paintDirtyTiles();
  }

  clear(): void {
    this.paintGen += 1;
    for (const t of this.tiles) t.canvas.remove();
    this.tiles = [];
    this.slots = [];
    this.ticketsById = new Map();
  }

  private syncTiles(): void {
    const layout = getActiveLayout();
    const { cardHeight } = layout;
    const n = this.slots.length;
    const budget = CANVAS_TILE_TICKETS;

    if (n === 0) {
      this.clear();
      return;
    }

    const needed = Math.ceil(n / budget);

    // Shrink extras
    while (this.tiles.length > needed) {
      const t = this.tiles.pop()!;
      t.canvas.remove();
    }

    for (let i = 0; i < needed; i++) {
      const start = i * budget;
      const end = Math.min(n, start + budget);
      const first = this.slots[start]!;
      const last = this.slots[end - 1]!;
      const minY = first.y;
      const cssH = Math.max(1, last.y + cardHeight - minY);

      let tile = this.tiles[i];
      if (!tile) {
        const canvas = document.createElement("canvas");
        canvas.className = "ticketCanvasLayer";
        canvas.style.position = "absolute";
        canvas.style.left = "0";
        canvas.style.pointerEvents = "none";
        canvas.style.opacity = "1";
        canvas.style.visibility = "visible";
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        this.host.appendChild(canvas);
        tile = { canvas, ctx, start, end, minY, cssH, dirty: true };
        this.tiles[i] = tile;
      }

      const rangeChanged = tile.start !== start || tile.end !== end;
      const geomChanged = tile.minY !== minY || tile.cssH !== cssH;
      tile.start = start;
      tile.end = end;
      tile.minY = minY;
      tile.cssH = cssH;
      if (rangeChanged || geomChanged) tile.dirty = true;

      tile.canvas.style.transform = `translate3d(0, ${minY}px, 0)`;
    }
  }

  private async paintDirtyTiles(): Promise<void> {
    if (this.paused) return; // scrolling — dirty tiles flush on resume()
    const gen = ++this.paintGen;
    for (const tile of this.tiles) {
      if (gen !== this.paintGen) return;
      if (this.paused) return; // a scroll started mid-paint — stop, flush on resume
      if (!tile.dirty) continue;
      this.paintTile(tile);
      tile.dirty = false;
      // Yield between tiles so adding hundreds doesn't freeze the main thread.
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  private paintTile(tile: Tile): void {
    const c = tile.canvas;
    const ctx = tile.ctx;
    const layout = getActiveLayout();
    const { cardWidth, metrics } = layout;
    const cssW = contentWidth(layout);
    const cssH = tile.cssH;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);

    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    // Snap tile origin to device pixels.
    const minY = Math.round(tile.minY * dpr) / dpr;
    c.style.width = `${cssW}px`;
    c.style.height = `${cssH}px`;
    c.style.transform = `translate3d(0, ${minY}px, 0)`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = false;

    const geo = getTicketGeometry();
    const live = getLiveCellBoxModel() ?? resolveCellBoxModel(layout, dpr);
    const boxes =
      geo && geo.cardWidth === cardWidth && geo.cellW === live.cellW
        ? geo.cells
        : live.cells;
    const useSprites = Boolean(
      geo &&
      geo.cardWidth === cardWidth &&
      geo.cellW === live.cellW &&
      geo.cellH === live.cellH,
    );

    for (let i = tile.start; i < tile.end; i++) {
      const slot = this.slots[i]!;
      const ticket = this.ticketsById.get(slot.id);
      if (!ticket) continue;

      const gold = isWinTicket(ticket);
      const x = Math.round(slot.x * dpr) / dpr;
      const y = Math.round((slot.y - tile.minY) * dpr) / dpr;

      paintChrome(ctx, x, y, ticket.no, cardWidth, metrics, gold);

      // Absolute device-pixel origins once — do NOT snap slot and box.y separately
      // (that double-rounds fractional bodyTop=19.5 on dpr 1.25/1.5 → Y crawl).
      const slotYDev = Math.round(slot.y * dpr);
      const slotXDev = Math.round(slot.x * dpr);
      const tileYDev = Math.round(tile.minY * dpr);

      for (let k = 0; k < BALLS_PER_TICKET; k++) {
        const n = ticket.balls[k];
        if (n == null) continue;
        const box = boxes[k]!;
        const bxDev = Math.round((slot.x + box.x) * dpr);
        const byDev = Math.round((slot.y + box.y) * dpr);

        // Number sprite first…
        const bmp = useSprites ? getCellBitmap(n) : undefined;
        if (bmp) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(bmp, bxDev, byDev - tileYDev);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        // …then the dab / multiplier disc ON TOP (covers the digit, like the DOM).
        if (ticket.hits.includes(k)) {
          const cx = slot.x + box.x + box.w / 2;
          const cy = slot.y - tile.minY + box.y + box.h / 2;
          paintBadge(ctx, cx, cy, metrics.dabSize, ticket.multipliers[k] ?? 0, dpr);
        }
      }

      // Separators between cells (not inside sprites).
      paintSeparators(
        ctx,
        slotXDev / dpr,
        (slotYDev - tileYDev) / dpr,
        boxes,
        metrics,
        gold,
      );
    }
  }
}

/**
 * Draw an image centred at (cx,cy) using `background-size: contain` semantics —
 * scale to fit within a dabSize box preserving aspect (the discs aren't square).
 */
function drawContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  dabSize: number,
): void {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (iw <= 0 || ih <= 0) return;
  const scale = Math.min(dabSize / iw, dabSize / ih);
  const w = iw * scale;
  const h = ih * scale;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
}

/** Dab / multiplier disc + label, centred on the cell (art, so smoothing on). */
function paintBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dabSize: number,
  multiplier: number,
  dpr: number,
): void {
  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  if (multiplier > 0) {
    const disc = getDiscImage();
    if (disc) drawContain(ctx, disc, cx, cy, dabSize);
    const label = getMultiplierLabel(multiplier);
    if (label) {
      const lw = label.width / dpr;
      const lh = label.height / dpr;
      ctx.drawImage(label, cx - lw / 2, cy - lh / 2, lw, lh);
    }
  } else {
    const dab = getDabImage();
    if (dab) drawContain(ctx, dab, cx, cy, dabSize);
  }
  ctx.imageSmoothingEnabled = prevSmoothing;
}

function paintChrome(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ticketNo: string,
  cardWidth: number,
  m: ReturnType<typeof getActiveLayout>["metrics"],
  gold: boolean,
): void {
  const r = m.radius;
  const cardHeight = m.cardHeight;
  ctx.save();
  roundRectPath(ctx, x, y, cardWidth, cardHeight, r);
  ctx.clip();

  // Card face
  ctx.fillStyle = gold ? "#FFD65C" : "#F8EADB";
  ctx.fillRect(x, y, cardWidth, cardHeight);

  // Body gradient
  const bodyGrad = ctx.createLinearGradient(
    x,
    y + m.headerHeight,
    x,
    y + cardHeight,
  );
  if (gold) {
    bodyGrad.addColorStop(0, "#FFE96E");
    bodyGrad.addColorStop(0.5, "#FFD054");
    bodyGrad.addColorStop(1, "#F98900");
  } else {
    bodyGrad.addColorStop(0, "#FFFFFF");
    bodyGrad.addColorStop(1, "#F3EAE0");
  }
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(x, y + m.headerHeight, cardWidth, m.bodyHeight);

  // Header
  if (gold) {
    const headGrad = ctx.createLinearGradient(x, y, x, y + m.headerHeight);
    headGrad.addColorStop(0, "#FFEFA5");
    headGrad.addColorStop(1, "#FFD65C");
    ctx.fillStyle = headGrad;
  } else {
    ctx.fillStyle = "#F8EADB";
  }
  ctx.fillRect(x, y, cardWidth, m.headerHeight);

  // Ticket id (still fillText for now — sprite ID atlas is the next step).
  ctx.fillStyle = gold ? "#9F8080" : "#B19797";
  ctx.font = `700 ${m.metaFontSize}px MB-Onest, Onest, system-ui, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(ticketNo, x + cardWidth - m.headerPadX, y + m.headerHeight - 1);

  ctx.restore();
}

function paintSeparators(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  boxes: { x: number; y: number; w: number; h: number }[],
  m: ReturnType<typeof getActiveLayout>["metrics"],
  gold: boolean,
): void {
  const sep = m.separatorWidth;
  if (sep <= 0 || boxes.length < 2) return;
  const dpr = ctx.getTransform().a || 1;
  ctx.fillStyle = gold ? "#CB9330" : "rgb(177 151 151 / 50%)";
  for (let i = 1; i < boxes.length; i++) {
    const box = boxes[i]!;
    // Absolute snap once (same rule as cell blit).
    const sx = Math.round((x + box.x - sep) * dpr) / dpr;
    const sy = Math.round((y + box.y + m.separatorMarginTop) * dpr) / dpr;
    ctx.fillRect(sx, sy, sep, m.separatorHeight);
  }
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
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
