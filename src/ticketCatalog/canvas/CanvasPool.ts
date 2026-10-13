import {
  badgeSurfaceForTicket,
  getDabImage,
  getDiscImage,
  getMultiplierBadge,
  getMultiplierLabelPlace,
} from "./atlas/badgeAtlas";
import { catalogCellBoxes, paintCatalogTicket } from "./paint/catalogPaint";
import { isCatalogSvgPaintReady, paintCatalogTicketSvgAll } from "./paint/catalogSvgPaint";
import { catalogLaneWidth, getActiveLayout } from "../layout/catalogLayout";
import { getCellBitmap } from "./atlas/cellAtlas";
import {
  activeDpr,
  badgeHostDevice,
  containDeviceRect,
} from "../layout/cellBoxModel";
import {
  getHeaderSprite,
  idGlyphsReady,
  type GlyphColor,
} from "./atlas/idDigitAtlas";
import { BALLS_PER_TICKET, canvasTileTickets } from "../constants";
import { isWinTicket, type Ticket, type TicketSlot } from "../model/tickets";

/** Prefer a cooperative yield over a flat setTimeout(0) floor. */
function yieldToMain(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } })
    .scheduler;
  if (sched?.yield) return sched.yield();
  return new Promise((r) => setTimeout(r, 0));
}

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
  /** Full tile clear+repaint (layout, ids, geometry). */
  dirtyFull: boolean;
  /** Catalog slot indices whose skip bit flipped — incremental repaint only. */
  skipFlipIndices: number[];
  /**
   * Device-pixel snap from the last full paintTile. Skip paints reuse this so
   * they never resize the buffer (canvas.width/height assignment clears it).
   */
  /** Content-space snap for ticket blits inside the tile (scroll-independent). */
  snap: {
    dpr: number;
    minY: number;
    cardWidth: number;
    cardHeight: number;
  } | null;
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
  /** Tickets the live DOM band is showing — left unpainted on canvas tiles. */
  private skipIds: Set<string> = new Set();
  private readonly host: HTMLElement;
  private paintGen = 0;
  private paused = false;
  private tileLayoutKey = "";

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
   *
   * Adding tickets only ever changes the last (short) row's x offsets
   * (`buildSlots`'s centering) and appends new indices; every earlier slot
   * keeps the same id/x/y. So instead of blanket-dirtying every tile on every
   * add (an O(whole catalog) repaint for a "+1"), we diff the previous
   * slots/skip set per tile and only dirty the ones whose painted content —
   * id, position, or skip (DOM-band) membership — actually changed.
   * `syncTiles()` still dirties a tile whose own range/geometry moved.
   */
  setCatalog(
    slots: readonly TicketSlot[],
    ticketsById: Map<string, Ticket>,
    skipIds: ReadonlySet<string> = this.skipIds,
  ): void {
    if (!this.ready) return;
    const prevSlots = this.slots;
    const prevSkipIds = this.skipIds;
    this.slots = slots.slice();
    this.ticketsById = ticketsById;
    this.skipIds = new Set(skipIds);
    this.syncTiles();
    this.markContentDirty(prevSlots, prevSkipIds);
    if (!this.paused) this.flushDirtyTilesSync();
  }

  /** Dirty a tile only if a slot it covers changed id, position, or skip state. */
  private markContentDirty(
    prevSlots: readonly TicketSlot[],
    prevSkipIds: ReadonlySet<string>,
  ): void {
    for (const tile of this.tiles) {
      if (tile.dirty) continue;
      for (let i = tile.start; i < tile.end; i++) {
        const next = this.slots[i];
        if (!next) continue;
        const prev = prevSlots[i];
        if (!prev || prev.id !== next.id || prev.x !== next.x || prev.y !== next.y) {
          tile.dirty = true;
          tile.dirtyFull = true;
          break;
        }
        if (prevSkipIds.has(next.id) !== this.skipIds.has(next.id)) {
          tile.dirty = true;
          tile.dirtyFull = true;
          break;
        }
      }
    }
  }

  /**
   * DOM band changed after scroll settled — canvas leaves holes for live DOM tickets.
   */
  setSkip(skipIds: ReadonlySet<string>, options?: { paint?: boolean }): void {
    if (sameIds(this.skipIds, skipIds)) return;
    const prev = this.skipIds;
    this.skipIds = new Set(skipIds);
    for (const tile of this.tiles) {
      let bandChanged = false;
      for (let i = tile.start; i < tile.end; i++) {
        const id = this.slots[i]?.id;
        if (!id) continue;
        if (prev.has(id) !== this.skipIds.has(id)) {
          bandChanged = true;
          break;
        }
      }
      if (!bandChanged) continue;
      tile.dirty = true;
      tile.dirtyFull = false;
      tile.skipFlipIndices = [];
    }
    if (options?.paint !== false) this.flushDirtyTilesSync();
  }

  /** Paint every dirty tile before the next frame. Used when the DOM band flips. */
  paintNow(): void {
    if (!this.ready) return;
    void this.flushDirtyTiles();
  }

  /** Band / skip updates: finish every dirty tile in one turn (no inter-tile yield). */
  private flushDirtyTilesSync(): void {
    const gen = ++this.paintGen;
    for (const tile of this.tiles) {
      if (gen !== this.paintGen) return;
      if (!tile.dirty) continue;
      if (tile.dirtyFull || !tile.snap) {
        this.paintTile(tile, gen);
      } else {
        this.compositeTileFromSnap(tile, gen);
      }
      if (gen !== this.paintGen) return;
      tile.dirty = false;
      tile.dirtyFull = false;
      tile.skipFlipIndices = [];
    }
  }

  /** Await the current dirty-tile flush (e.g. before smooth-scroll after a bulk add). */
  waitForPaint(): Promise<void> {
    if (!this.ready || this.paused) return Promise.resolve();
    return this.flushDirtyTiles();
  }

  private async flushDirtyTiles(): Promise<void> {
    const gen = ++this.paintGen;
    let painted = false;
    for (const tile of this.tiles) {
      if (gen !== this.paintGen) return;
      if (!tile.dirty) continue;
      if (painted) await yieldToMain();
      if (tile.dirtyFull || !tile.snap) {
        this.paintTile(tile, gen);
      } else {
        this.compositeTileFromSnap(tile, gen);
      }
      tile.dirty = false;
      tile.dirtyFull = false;
      tile.skipFlipIndices = [];
      painted = true;
    }
  }

  /** Dirty and paint tiles that contain any of the given catalog slot indices. */
  refreshForSlotIndices(indices: readonly number[]): void {
    if (!this.ready || indices.length === 0) return;
    const indexSet = new Set(indices);
    for (const tile of this.tiles) {
      if (tile.dirty) continue;
      for (let i = tile.start; i < tile.end; i++) {
        if (indexSet.has(i)) {
          tile.dirty = true;
          tile.dirtyFull = true;
          break;
        }
      }
    }
    if (this.paused) return;
    this.flushDirtyTilesSync();
  }

  /** Dirty and paint tiles covering these ticket ids (draw / face updates). */
  refreshForTicketIds(ids: ReadonlySet<string>): void {
    if (!this.ready || ids.size === 0) return;
    const indices: number[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      const id = this.slots[i]?.id;
      if (!id || !ids.has(id) || this.skipIds.has(id)) continue;
      indices.push(i);
    }
    this.refreshForSlotIndices(indices);
  }

  /**
   * State changed (a draw, a shuffle). Paint every tile now, before the
   * browser can scroll over a tile that still shows the previous frame.
   */
  refresh(): void {
    if (!this.ready) return;
    for (const t of this.tiles) {
      t.dirty = true;
      t.dirtyFull = true;
    }
    if (this.paused) return;
    this.flushDirtyTilesSync();
  }

  clear(): void {
    this.paintGen += 1;
    this.tileLayoutKey = "";
    for (const t of this.tiles) t.canvas.remove();
    this.tiles = [];
    this.slots = [];
    this.ticketsById = new Map();
    this.skipIds = new Set();
  }

  private syncTiles(): void {
    const layout = getActiveLayout();
    const { cardHeight, gap } = layout;
    const cssW = catalogLaneWidth(layout);
    const layoutKey = `${layout.cardWidth}|${layout.cardHeight}|${cssW}`;
    if (this.tileLayoutKey && this.tileLayoutKey !== layoutKey) {
      this.paintGen += 1;
      for (const tile of this.tiles) {
        tile.dirty = true;
        tile.dirtyFull = true;
        tile.snap = null;
        if (tile.canvas.width > 0) {
          tile.ctx.setTransform(1, 0, 0, 1, 0, 0);
          tile.ctx.clearRect(0, 0, tile.canvas.width, tile.canvas.height);
        }
      }
    }
    this.tileLayoutKey = layoutKey;

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
      const cssH = Math.max(1, last.y + cardHeight + gap - minY);

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
        tile = {
          canvas,
          ctx,
          start,
          end,
          minY,
          cssH,
          dirty: true,
          dirtyFull: true,
          skipFlipIndices: [],
          snap: null,
        };
        this.tiles[i] = tile;
      }

      const rangeChanged = tile.start !== start || tile.end !== end;
      const geomChanged = tile.minY !== minY || tile.cssH !== cssH;
      tile.start = start;
      tile.end = end;
      tile.minY = minY;
      tile.cssH = cssH;
      if (rangeChanged || geomChanged) {
        tile.dirty = true;
        tile.dirtyFull = true;
        tile.skipFlipIndices = [];
        tile.snap = null;
      }

      tile.canvas.style.transform = `translate3d(0, ${minY}px, 0)`;
    }
  }

  /** Device-pixel origin of a slot inside its tile bitmap (content coords only). */
  /** Erase canvas ink anywhere the live DOM owns a ticket (device pixels). */
  private punchSkipHoles(
    ctx: CanvasRenderingContext2D,
    tile: Tile,
    snap: NonNullable<Tile["snap"]>,
  ): void {
    const w = Math.max(1, Math.round(snap.cardWidth * snap.dpr));
    const h = Math.max(1, Math.round(snap.cardHeight * snap.dpr));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    for (let i = tile.start; i < tile.end; i++) {
      const slot = this.slots[i];
      if (!slot || !this.skipIds.has(slot.id)) continue;
      const { x, y } = this.slotOriginOnTile(slot, snap);
      ctx.clearRect(x, y, w, h);
    }
  }

  private slotOriginOnTile(
    slot: TicketSlot,
    snap: NonNullable<Tile["snap"]>,
  ): { x: number; y: number } {
    const dpr = snap.dpr;
    const sx = Math.round(slot.x * dpr) / dpr;
    const sy = Math.round(slot.y * dpr) / dpr;
    return {
      x: Math.round(sx * dpr),
      y: Math.round((sy - snap.minY) * dpr),
    };
  }

  /**
   * One atomic blit per tile after a DOM-band change — avoids per-slot clears
   * visible under throttle (shuffle / scroll settle).
   */
  private compositeTileFromSnap(tile: Tile, gen: number): void {
    const snap = tile.snap;
    if (!snap) return;
    const ctx = tile.ctx;
    const layout = getActiveLayout();
    const cssW = catalogLaneWidth(layout);
    const bw = Math.max(1, Math.round(cssW * snap.dpr));
    const bh = Math.max(1, Math.round(tile.cssH * snap.dpr));
    const scratch = document.createElement("canvas");
    scratch.width = bw;
    scratch.height = bh;
    const sctx = scratch.getContext("2d");
    if (!sctx) return;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.imageSmoothingEnabled = false;
    sctx.clearRect(0, 0, bw, bh);
    const boxes = catalogCellBoxes(snap.dpr);
    for (let i = tile.start; i < tile.end; i++) {
      if (gen !== this.paintGen) return;
      const slot = this.slots[i]!;
      const ticket = this.ticketsById.get(slot.id);
      if (!ticket || this.skipIds.has(slot.id)) continue;
      this.paintSlotOnTile(sctx, slot, ticket, snap, layout, boxes);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch, 0, 0);
    this.punchSkipHoles(ctx, tile, snap);
  }

  private paintSlotOnTile(
    ctx: CanvasRenderingContext2D,
    slot: TicketSlot,
    ticket: Ticket,
    snap: NonNullable<Tile["snap"]>,
    layout: ReturnType<typeof getActiveLayout>,
    boxes: { x: number; y: number; w: number; h: number }[],
  ): void {
    if (this.skipIds.has(slot.id)) return;
    const dpr = snap.dpr;
    const { cardWidth } = layout;
    const { x: originX, y: originY } = this.slotOriginOnTile(slot, snap);
    if (isCatalogSvgPaintReady()) {
      paintCatalogTicketSvgAll(ctx, ticket, originX, originY, layout, dpr);
    } else {
      paintCatalogTicket(ctx, ticket, originX, originY, cardWidth, dpr, boxes);
    }
  }

  private paintTile(tile: Tile, gen: number): void {
    if (this.paused || gen !== this.paintGen) return;
    const c = tile.canvas;
    const ctx = tile.ctx;
    const layout = getActiveLayout();
    const { cardWidth, cardHeight } = layout;
    const cssW = catalogLaneWidth(layout);
    const dpr = activeDpr();
    const minY = Math.round(tile.minY * dpr) / dpr;
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(tile.cssH * dpr));
    const needsResize = c.width !== bw || c.height !== bh;

    tile.snap = {
      dpr,
      minY,
      cardWidth,
      cardHeight,
    };

    c.style.width = `${bw / dpr}px`;
    c.style.height = `${bh / dpr}px`;
    c.style.transform = `translate3d(0, ${minY}px, 0)`;

    const boxes = catalogCellBoxes(dpr);
    const snap = tile.snap;

    let paintCtx: CanvasRenderingContext2D;
    let scratch: HTMLCanvasElement | null = null;
    if (needsResize) {
      c.width = bw;
      c.height = bh;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, bw, bh);
      paintCtx = ctx;
    } else {
      scratch = document.createElement("canvas");
      scratch.width = bw;
      scratch.height = bh;
      const sctx = scratch.getContext("2d");
      if (!sctx) return;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.imageSmoothingEnabled = false;
      sctx.clearRect(0, 0, bw, bh);
      paintCtx = sctx;
    }

    for (let i = tile.start; i < tile.end; i++) {
      if (gen !== this.paintGen) return;
      const slot = this.slots[i]!;
      const ticket = this.ticketsById.get(slot.id);
      if (!ticket || this.skipIds.has(slot.id)) continue;
      this.paintSlotOnTile(paintCtx, slot, ticket, snap, layout, boxes);
    }

    if (scratch) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(scratch, 0, 0);
    }
    this.punchSkipHoles(ctx, tile, snap);
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
    const hit = ticket.hits.includes(k);
    const isMult = hit && mult > 0;

    // Dab / multiplier cover the digit once the cell is hit.
    const bmp = useSprites && !hit ? getCellBitmap(n) : undefined;
    if (bmp) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(bmp, bxDev, byDev - tileYDev);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    if (hit) {
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
