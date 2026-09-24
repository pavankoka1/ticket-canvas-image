import {
  badgeSurfaceForTicket,
  getDabImage,
  getDiscImage,
  getMultiplierBadge,
  getMultiplierLabelPlace,
} from "./badgeAtlas";
import { catalogCellBoxes, paintCatalogTicket } from "./catalogPaint";
import { contentWidth, getActiveLayout } from "./catalogLayout";
import { getCellBitmap } from "./cellAtlas";
import {
  activeDpr,
  badgeHostDevice,
  containDeviceRect,
} from "./cellBoxModel";
import {
  getHeaderSprite,
  idGlyphsReady,
  type GlyphColor,
} from "./idDigitAtlas";
import { BALLS_PER_TICKET, canvasTileTickets } from "./layout";
import { isWinTicket, type Ticket, type TicketSlot } from "./tickets";

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

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
  /** Tickets the live DOM is showing. Those slots stay blank on the canvas. */
  private skipIds: Set<string> = new Set();
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
    this.paintNow();
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
    skipIds: ReadonlySet<string> = this.skipIds,
  ): void {
    if (!this.ready) return;
    this.slots = slots.slice();
    this.ticketsById = ticketsById;
    this.skipIds = new Set(skipIds);
    this.syncTiles();
    for (const tile of this.tiles) tile.dirty = true;
    this.blankTiles();
    void this.paintDirtyTiles();
  }

  /** Live DOM band changed. Repaint so those slots are empty, or filled again. */
  setSkip(skipIds: ReadonlySet<string>): void {
    if (sameIds(this.skipIds, skipIds)) return;
    const prev = this.skipIds;
    this.skipIds = new Set(skipIds);
    for (const tile of this.tiles) {
      for (let i = tile.start; i < tile.end; i++) {
        const id = this.slots[i]?.id;
        if (!id) continue;
        if (prev.has(id) !== this.skipIds.has(id)) {
          tile.dirty = true;
          break;
        }
      }
    }
    this.paintNow();
  }

  /** Paint every dirty tile before the next frame. Used when the DOM band flips. */
  paintNow(): void {
    if (!this.ready) return;
    this.paintGen += 1;
    for (const tile of this.tiles) {
      if (!tile.dirty) continue;
      this.paintTile(tile);
      tile.dirty = false;
    }
  }

  /**
   * State changed (a draw, a shuffle). Paint every tile now, before the
   * browser can scroll over a tile that still shows the previous frame.
   */
  refresh(): void {
    if (!this.ready) return;
    for (const t of this.tiles) t.dirty = true;
    if (this.paused) return;
    this.paintNow();
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
    const budget = canvasTileTickets(activeDpr());

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

  private blankTiles(): void {
    for (const tile of this.tiles) {
      tile.ctx.setTransform(1, 0, 0, 1, 0, 0);
      tile.ctx.clearRect(0, 0, tile.canvas.width, tile.canvas.height);
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
    const { cardWidth } = layout;
    const cssW = contentWidth(layout);
    const dpr = activeDpr();
    // Size the buffer to the device pixels this tile actually covers.
    // round(css * dpr) and that span disagree when the tile top is fractional,
    // and the browser then scales the bitmap. A tall tile turns that into a
    // visible multiplier shift. Compare never hits it: its canvas is the card.
    const minY = Math.round(tile.minY * dpr) / dpr;
    const parent = this.host.getBoundingClientRect();
    const screenTop = parent.top + minY;
    const screenLeft = parent.left;
    const y0 = Math.round(screenTop * dpr);
    const x0 = Math.round(screenLeft * dpr);
    const bw = Math.max(1, Math.round((screenLeft + cssW) * dpr) - x0);
    const bh = Math.max(1, Math.round((screenTop + tile.cssH) * dpr) - y0);

    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    c.style.width = `${bw / dpr}px`;
    c.style.height = `${bh / dpr}px`;
    c.style.transform = `translate3d(0, ${minY}px, 0)`;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, bw, bh);

    const boxes = catalogCellBoxes(dpr);

    for (let i = tile.start; i < tile.end; i++) {
      const slot = this.slots[i]!;
      const ticket = this.ticketsById.get(slot.id);
      if (!ticket || this.skipIds.has(slot.id)) continue;
      const sx = Math.round(slot.x * dpr) / dpr;
      const sy = Math.round(slot.y * dpr) / dpr;
      const originX = Math.round((screenLeft + sx) * dpr) - x0;
      const originY = Math.round((parent.top + sy) * dpr) - y0;
      paintCatalogTicket(ctx, ticket, originX, originY, cardWidth, dpr, boxes);
    }
  }
}

/** Paint one ticket at its slot. Used by CanvasPool and /compare. */
export function paintTicket(
  ctx: CanvasRenderingContext2D,
  slot: TicketSlot,
  ticket: Ticket,
  cardWidth: number,
  metrics: ReturnType<typeof getActiveLayout>["metrics"],
  dpr: number,
  tileMinY: number,
  boxes: { x: number; y: number; w: number; h: number }[],
  useSprites: boolean,
): void {
  const gold = isWinTicket(ticket);
  const disabled = Boolean(ticket.disabled);
  const x = Math.round(slot.x * dpr) / dpr;
  const y = Math.round((slot.y - tileMinY) * dpr) / dpr;

  paintChrome(ctx, x, y, cardWidth, metrics, gold, disabled);
  paintHeaderText(ctx, slot, ticket, gold, metrics, cardWidth, dpr, tileMinY);

  const slotYDev = Math.round(slot.y * dpr);
  const slotXDev = Math.round(slot.x * dpr);
  const tileYDev = Math.round(tileMinY * dpr);
  const badgeSurface = badgeSurfaceForTicket(ticket);

  for (let k = 0; k < BALLS_PER_TICKET; k++) {
    const n = ticket.balls[k];
    if (n == null) continue;
    const box = boxes[k]!;
    const bxDev = Math.round((slot.x + box.x) * dpr);
    const byDev = Math.round((slot.y + box.y) * dpr);

    const mult = ticket.multipliers[k] ?? 0;
    const isMult = ticket.hits.includes(k) && mult > 0;

    // Multiplier disc covers the digit. Skip the number under it.
    const bmp = useSprites && !isMult ? getCellBitmap(n) : undefined;
    if (bmp) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(bmp, bxDev, byDev - tileYDev);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    if (ticket.hits.includes(k)) {
      const originX = Math.round(slot.x * dpr);
      const originY = slotYDev - tileYDev;
      const host = badgeHostDevice(box, metrics.dabSize, dpr);
      const disc = isMult ? getDiscImage() : getDabImage();
      if (disc) paintDisc(ctx, originX + host.x, originY + host.y, host, disc, dpr);
      if (isMult) {
        const badge = getMultiplierBadge(mult, badgeSurface);
        const place = getMultiplierLabelPlace(mult);
        if (badge && place) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(
            badge,
            originX + host.x + place.dx,
            originY + host.y + place.dy,
          );
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
      }
    }
  }

  paintSeparators(
    ctx,
    slotXDev / dpr,
    (slotYDev - tileYDev) / dpr,
    boxes,
    metrics,
    gold,
  );
}

/** Disc PNG into the same device rect the DOM background uses. */
function paintDisc(
  ctx: CanvasRenderingContext2D,
  hostX: number,
  hostY: number,
  host: { x: number; y: number; w: number; h: number },
  img: HTMLImageElement,
  dpr: number,
): void {
  const dest = containDeviceRect(
    { x: hostX, y: hostY, w: host.w, h: host.h },
    img.naturalWidth,
    img.naturalHeight,
    dpr,
  );
  const prev = ctx.imageSmoothingEnabled;
  const prevQ = ctx.imageSmoothingQuality;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, dest.x, dest.y, dest.w, dest.h);
  ctx.imageSmoothingEnabled = prev;
  ctx.imageSmoothingQuality = prevQ;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function paintChrome(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cardWidth: number,
  m: ReturnType<typeof getActiveLayout>["metrics"],
  gold: boolean,
  disabled = false,
): void {
  const r = m.radius;
  const cardHeight = m.cardHeight;
  ctx.save();
  roundRectPath(ctx, x, y, cardWidth, cardHeight, r);
  ctx.clip();

  // Card face
  ctx.fillStyle = disabled ? "#0C8F7E" : gold ? "#FFD65C" : "#F8EADB";
  ctx.fillRect(x, y, cardWidth, cardHeight);

  // Body gradient
  const bodyGrad = ctx.createLinearGradient(
    x,
    y + m.headerHeight,
    x,
    y + cardHeight,
  );
  if (disabled) {
    bodyGrad.addColorStop(0, "#1AAD9A");
    bodyGrad.addColorStop(0.5, "#0C8F7E");
    bodyGrad.addColorStop(1, "#087A6A");
  } else if (gold) {
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
  if (disabled) {
    const headGrad = ctx.createLinearGradient(x, y, x, y + m.headerHeight);
    headGrad.addColorStop(0, "#14A894");
    headGrad.addColorStop(1, "#0C8F7E");
    ctx.fillStyle = headGrad;
  } else if (gold) {
    const headGrad = ctx.createLinearGradient(x, y, x, y + m.headerHeight);
    headGrad.addColorStop(0, "#FFEFA5");
    headGrad.addColorStop(1, "#FFD65C");
    ctx.fillStyle = headGrad;
  } else {
    ctx.fillStyle = "#F8EADB";
  }
  ctx.fillRect(x, y, cardWidth, m.headerHeight);

  ctx.restore();
}

/**
 * ID (right-aligned) + win amount (left-aligned) as whole-string SnapDOM
 * sprites — pixel-identical to the DOM header nodes. Falls back to fillText
 * only while a given string is still warming.
 */
function paintHeaderText(
  ctx: CanvasRenderingContext2D,
  slot: TicketSlot,
  ticket: Ticket,
  gold: boolean,
  m: ReturnType<typeof getActiveLayout>["metrics"],
  cardWidth: number,
  dpr: number,
  tileMinY: number,
): void {
  const win = isWinTicket(ticket);
  const idColor: GlyphColor = gold ? "idGold" : "idNormal";
  const idSpr = idGlyphsReady()
    ? getHeaderSprite(ticket.no, idColor)
    : undefined;
  const winSpr =
    win && ticket.win && idGlyphsReady()
      ? getHeaderSprite(ticket.win, "win")
      : undefined;

  if (idSpr || winSpr) {
    const topDev = Math.round(slot.y * dpr) - Math.round(tileMinY * dpr);
    const leftDev = Math.round(slot.x * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Full-header sprites — position is baked in (same flex as live DOM).
    if (winSpr) ctx.drawImage(winSpr, leftDev, topDev);
    if (idSpr) ctx.drawImage(idSpr, leftDev, topDev);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  if (idSpr && (winSpr || !win || !ticket.win)) return;

  // Fallback for any string not yet in the atlas.
  const x = Math.round(slot.x * dpr) / dpr;
  const y = Math.round((slot.y - tileMinY) * dpr) / dpr;
  ctx.font = `700 ${m.metaFontSize}px MB-Onest, Onest, system-ui, sans-serif`;
  ctx.textBaseline = "bottom";
  if (!idSpr) {
    ctx.fillStyle = gold ? "#9F8080" : "#B19797";
    ctx.textAlign = "right";
    ctx.fillText(ticket.no, x + cardWidth - m.headerPadX, y + m.headerHeight - 1);
  }
  if (win && ticket.win && !winSpr) {
    ctx.fillStyle = "#704F4F";
    ctx.textAlign = "left";
    ctx.fillText(ticket.win, x + m.headerPadX, y + m.headerHeight - 1);
  }
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
