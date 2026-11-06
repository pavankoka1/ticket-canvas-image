import {
  APPEAR_MAX_TICKETS,
  APPEAR_MS,
  prefersReducedMotion,
  TICKET_ANIMATED_COUNT,
} from "./animation/appear";
import { computeDomBand } from "./dom/bands";
import { CanvasPool } from "./canvas/CanvasPool";
import {
  activeDpr,
  applyCellBoxCssVars,
  getLiveCellBoxModel,
  setLiveCellBoxModel,
} from "./layout/cellBoxModel";
import {
  contentHeight,
  contentWidth,
  catalogLayoutCacheKey,
  catalogLayoutIsLandscape,
  getActiveLayout,
  resolveCatalogLayout,
  setActiveLayout,
  type CatalogLayout,
} from "./layout/catalogLayout";
import { resolveShufflePlan } from "./animation/drawPhase";
import { resolveLiveCellBoxModel } from "./canvas/atlas/cellAtlas";
import { ensureTicketFontsForLayout } from "./layout/ticketFont";
import {
  ensureCatalogSvgAtlasWarm,
  prewarmCatalogSvgPaintJit,
  warmCatalogAtlasForPrewarm,
} from "./canvas/paint/catalogSvgPaint";
import { DomPool } from "./dom/DomPool";
import { MAX_TICKETS, ROW_BUFFER, SCROLL_BAND_SETTLE_MS, domPoolSize } from "./constants";
import {
  applyDrawnBall,
  buildSlots,
  createTickets,
  DRAW_ROUND_COUNT,
  DRAW_ROUNDS,
  drawGestureMs,
  finishRound,
  pickDrawBall,
  sortTickets,
  type Ticket,
  type TicketSlot,
} from "./model/tickets";
import { snapCatalogFrameOrigin } from "./layout/catalogOriginSnap";
import { applyTicketCssVars, resolveTicketMetrics } from "./model/ticketPresets";
import { resolveTicketSparklePlan } from "./dom/ticketSparkles";
import type { ToolbarRefs } from "./buildToolbar";

const RESIZE_CANVAS_SETTLE_MS = 300;
const SCROLL_TOP_EPSILON_PX = 1;
/** How long past its nominal length a draw gesture may run before we stop waiting. */
const GESTURE_SETTLE_GRACE_MS = 2000;
export type TicketCatalogControllerHost = {
  root: HTMLElement;
  ui: ToolbarRefs;
  catalogFrame: HTMLElement;
  ticketCatalogHost: HTMLElement;
  scroll: HTMLDivElement;
  content: HTMLDivElement;
  canvasHost: HTMLDivElement;
  domHost: HTMLDivElement;
  atlasHost: HTMLDivElement;
  prewarmHost: HTMLDivElement;
};

export class TicketCatalogController {
  private readonly host: TicketCatalogControllerHost;
  private dom: DomPool | null = null;
  private canvas: CanvasPool | null = null;
  private poolSize = 0;

  private tickets: Ticket[] = [];
  private slots: TicketSlot[] = [];
  private ticketsById = new Map<string, Ticket>();
  private canvasReady = false;

  private availableWidth = 0;
  private drawRound = 0;
  private lastDraw = "";
  private drawnBalls: number[] = [];
  private domCount = 0;

  private clientHeight = 0;
  private atlasGen = 0;
  private prevLayoutKey = "";
  private prevPaintLayoutKey = "";

  private freshIds = new Set<string>();
  private knownIds = new Set<string>();
  private shuffleTimer = 0;
  private roundEndTimer = 0;
  /** Drops a superseded draw's sort and round result — the next ball owns them. */
  private drawGen = 0;
  private scrollTimer = 0;
  private resizeCanvasTimer = 0;
  private warmTimer = 0;

  private scrollCleanup: (() => void) | null = null;
  private resizeCleanup: (() => void) | null = null;
  private ro: ResizeObserver | null = null;
  private originRo: ResizeObserver | null = null;
  private bandResyncGen = 0;
  private lastBandFingerprint = "";
  /** Bumped to drop a settle rAF chain or an in-flight tile flush's DOM hide. */
  private settleGen = 0;
  private settleInFlight = false;
  private domHideQueue: number[] = [];
  private bulkScrollResyncTimer = 0;
  private resizeCanvasForcePending = false;
  private scrollSettleTimer = 0;
  private scrollMotionActive = false;
  private statsDirtyKey = "";
  /** Canvas cleared for DOM WAAPI — rebuild async after gesture or on scroll cancel. */
  private gestureCanvasSuspended = false;
  private gestureCanvasTimer = 0;
  private orientationTimer = 0;
  /** DomPool motion batches in flight (draw, FLIP, appear). */
  private domMotions = 0;
  private overflowingStart: boolean | null = null;
  private landscapePrewarmArmed = false;
  private landscapePrewarmScheduled = false;
  /** Origin for `[catalog-warm]` phase logs on this mount. */
  private warmLogT0 = 0;
  /** Origin for `[catalog-resize]` logs on the current resize / layout pass. */
  private resizeLogT0 = 0;

  constructor(host: TicketCatalogControllerHost) {
    this.host = host;
  }

  start(): void {
    this.wireToolbar();
    this.ensurePools();
    this.measureHostWidth();
    this.measureScrollGeometry();
    this.applyLayout({ syncDomBand: true, syncCanvasCatalog: true });
    this.bindScroll();
    this.bindViewport();
    this.bindResizeObserver();

    this.startCanvasWarm();
  }

  /** Coalesce atlas warm with resize settle (Safari mobile URL bar shifts card width). */
  private scheduleAtlasWarm(): void {
    if (this.warmTimer) window.clearTimeout(this.warmTimer);
    this.warmTimer = window.setTimeout(() => {
      this.warmTimer = 0;
      this.startCanvasWarm();
    }, RESIZE_CANVAS_SETTLE_MS);
  }

  destroy(): void {
    if (this.warmTimer) window.clearTimeout(this.warmTimer);
    if (this.resizeCanvasTimer) window.clearTimeout(this.resizeCanvasTimer);
    if (this.scrollSettleTimer) window.clearTimeout(this.scrollSettleTimer);
    if (this.scrollTimer) window.clearTimeout(this.scrollTimer);
    if (this.bulkScrollResyncTimer) window.clearTimeout(this.bulkScrollResyncTimer);
    if (this.shuffleTimer) window.clearTimeout(this.shuffleTimer);
    if (this.roundEndTimer) window.clearTimeout(this.roundEndTimer);
    if (this.gestureCanvasTimer) window.clearTimeout(this.gestureCanvasTimer);
    if (this.orientationTimer) window.clearTimeout(this.orientationTimer);
    this.scrollCleanup?.();
    this.settleGen += 1;
    this.settleInFlight = false;
    this.resizeCleanup?.();
    this.ro?.disconnect();
    this.originRo?.disconnect();
    this.canvas?.clear();
    this.host.domHost.replaceChildren();
    this.dom = null;
    this.canvas = null;
    this.atlasGen += 1;
  }

  private wireToolbar(): void {
    const { ui } = this.host;
    ui.ticketAdds.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-add-count]");
      if (!t) return;
      this.addCount(Number(t.dataset.addCount));
    });

    ui.toolbar.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
      if (!btn) return;
      switch (btn.dataset.action) {
        case "reset":
          this.reset();
          break;
        case "rebuild-canvas":
          this.rebuildCanvas();
          break;
        case "draw":
          this.drawBall();
          break;
        case "clear-draws":
          this.clearDraws();
          break;
      }
    });
  }

  private ensurePools(): void {
    const poolSize = this.resolvePoolSize();
    if (this.dom && this.poolSize === poolSize) return;
    this.canvas?.clear();
    this.host.domHost.replaceChildren();
    this.dom = new DomPool(this.host.domHost, poolSize);
    this.canvas = new CanvasPool(this.host.canvasHost);
    this.domMotions = 0;
    this.dom.setMotionHooks({
      onMotionStart: () => {
        this.domMotions += 1;
        this.updateDomCompositorLayer();
      },
      onMotionEnd: () => {
        this.domMotions = Math.max(0, this.domMotions - 1);
        this.updateDomCompositorLayer();
        if (this.gestureCanvasSuspended) void this.finishGestureCanvasRestore();
      },
    });
    this.dom.mount();
    this.canvas.mount();
    this.poolSize = poolSize;
  }

  /** Drop tile canvases so DOM WAAPI can use the GPU compositor (Safari iOS). */
  private beginGestureCanvasSuspend(clearTiles = true): void {
    if (!this.canvasReady || !this.canvas) return;
    if (this.gestureCanvasTimer) window.clearTimeout(this.gestureCanvasTimer);
    this.gestureCanvasSuspended = true;
    this.hideCanvas();
    if (clearTiles) this.canvas.clear();
    else this.canvas.pause();
  }

  private scheduleGestureCanvasRestore(ms: number): void {
    if (this.gestureCanvasTimer) window.clearTimeout(this.gestureCanvasTimer);
    this.gestureCanvasTimer = window.setTimeout(() => {
      this.gestureCanvasTimer = 0;
      void this.finishGestureCanvasRestore();
    }, Math.max(0, ms));
  }

  private async finishGestureCanvasRestore(force = false): Promise<void> {
    // A draw that settles after its shuffle started must not repaint tiles mid-FLIP.
    if (!force && this.domMotions > 0) return;
    if (this.gestureCanvasTimer) {
      window.clearTimeout(this.gestureCanvasTimer);
      this.gestureCanvasTimer = 0;
    }
    if (!this.gestureCanvasSuspended || !this.canvasReady || !this.canvas) return;
    this.gestureCanvasSuspended = false;
    this.canvas.pause();
    this.syncCanvas();
    const scrollTop = this.host.scroll.scrollTop;
    const viewH = this.host.scroll.clientHeight;
    await this.canvas.resume();
    // The shuffle starts as the gesture ends, so it can suspend the canvas again
    // while we resume. Revealing tiles now would show them under a running FLIP.
    if (this.gestureCanvasSuspended) return;
    this.canvas.flushDirtyTilesInViewportSync(scrollTop, viewH);
    this.revealCanvas();
  }

  private cancelGestureCanvasForScroll(): void {
    if (!this.gestureCanvasSuspended) return;
    this.dom?.cancelAllMotion();
    void this.finishGestureCanvasRestore(true);
  }

  private resolvePoolSize(): number {
    const metrics = this.readMetrics();
    return domPoolSize(metrics.id.startsWith("mobile"));
  }

  private catalogAspectLandscape(): boolean {
    return catalogLayoutIsLandscape();
  }

  private readMetrics() {
    return resolveTicketMetrics(window.innerWidth, window.innerHeight);
  }

  private resolveLayout(): CatalogLayout {
    const metrics = this.readMetrics();
    const isMobile = metrics.id.startsWith("mobile");
    const isLandscape = this.catalogAspectLandscape();
    return resolveCatalogLayout(isMobile, isLandscape, this.availableWidth, metrics);
  }

  private measureHostWidth(observedInlineSize?: number): void {
    const ticketBox = this.host.catalogFrame;
    // FM column math uses ticketBox.clientWidth − reserve, but the shipped game keeps
    // 1001px grids (197px cards) because reserve reads 0 on the first RO measure and
    // the band never resizes. Gap + scrollbar are CSS on .ticketCatalog only.
    const w =
      observedInlineSize !== undefined && Number.isFinite(observedInlineSize)
        ? observedInlineSize
        : ticketBox.clientWidth;
    this.availableWidth = Math.max(0, Math.floor(w));
  }

  /** ResizeObserver — apply layout in the same frame (avoid one frame of stale card width). */
  private onCatalogFrameResize(observedInlineSize?: number): void {
    if (this.resizeLogT0 === 0) this.resizeLogT0 = performance.now();
    this.measureScrollGeometry();
    this.ensurePools();
    const layout = this.resolveLayout();
    this.resizeLog("frame-resize", {
      paintKey: catalogLayoutCacheKey(layout),
      observedW: observedInlineSize ?? this.availableWidth,
      preset: layout.metrics.id,
      cardW: layout.cardWidth,
    });
    this.applyLayout({ syncDomBand: true, syncCanvasCatalog: false }, observedInlineSize);
  }

  private stampBandFingerprintAtRest(): void {
    const { dom } = this.bandForScroll(this.host.scroll.scrollTop);
    this.lastBandFingerprint = this.bandFingerprint(dom);
  }

  private measureScrollGeometry(): void {
    this.clientHeight = this.host.scroll.clientHeight;
  }

  private bandForScroll(scrollTop: number) {
    return computeDomBand(
      this.slots,
      scrollTop,
      this.clientHeight,
      ROW_BUFFER,
      this.dom?.size ?? this.poolSize,
    );
  }

  /** Skip set for canvas: ids that actually have a DOM card (after rebind). */
  /** `CanvasPool` copies what it is given, so neither branch copies again. */
  private domSkipIds(): ReadonlySet<string> {
    const dom = this.dom;
    if (dom?.isReady) {
      const bound = dom.boundIds();
      if (bound.size > 0) return bound;
    }
    const band = this.bandForScroll(this.host.scroll.scrollTop).dom;
    const ids = new Set<string>();
    for (const slot of band) ids.add(slot.id);
    return ids;
  }

  private syncDom(
    domSlots?: readonly TicketSlot[],
    forceRebind = false,
  ): number[] {
    const dom = this.dom;
    if (!dom?.isReady) return [];
    const slots =
      domSlots ?? this.bandForScroll(this.host.scroll.scrollTop).dom;
    const fresh = this.freshIds;
    this.freshIds = new Set();
    const pendingHide = dom.rebind(slots, this.ticketsById, fresh, forceRebind);
    for (const id of fresh) this.knownIds.add(id);
    this.domCount = slots.length;
    return pendingHide;
  }

  private finishDomRebind(pendingHide: readonly number[]): void {
    this.dom?.hideEvictedSlots(pendingHide);
  }

  private syncCanvas(): void {
    const canvas = this.canvas;
    if (!canvas?.isReady) return;
    // Which tiles keep pixels is a function of the scrollport, so tell the pool
    // where it is before any paint decides what to allocate.
    canvas.setViewport(this.host.scroll.scrollTop, this.host.scroll.clientHeight);
    canvas.setCatalog(this.slots, this.ticketsById, this.domSkipIds());
    this.updateStats();
  }

  private revealCanvas(): void {
    this.host.canvasHost.style.visibility = "visible";
    this.canvas?.resume();
  }

  private hideCanvas(): void {
    this.host.canvasHost.style.visibility = "hidden";
    this.canvas?.pause();
  }

  private syncCellBoxCssVarsOnHosts(): void {
    const model = getLiveCellBoxModel();
    if (!model) return;
    const metrics = getActiveLayout().metrics;
    applyCellBoxCssVars(this.host.root, model, metrics);
    applyCellBoxCssVars(this.host.atlasHost, model, metrics);
  }

  private applyLayout(
    opts: { syncDomBand: boolean; syncCanvasCatalog: boolean },
    observedInlineSize?: number,
  ): void {
    this.measureHostWidth(observedInlineSize);
    this.measureScrollGeometry();
    const prevLayout = getActiveLayout();
    const layout = this.resolveLayout();
    const key = catalogLayoutCacheKey(layout);
    const layoutChanged = key !== this.prevLayoutKey;
    const motionGeometryChanged =
      layout.cardWidth !== prevLayout.cardWidth ||
      layout.columns !== prevLayout.columns ||
      layout.cardHeight !== prevLayout.cardHeight;

    setActiveLayout(layout);
    const model = resolveLiveCellBoxModel(layout);
    setLiveCellBoxModel(model);
    applyCellBoxCssVars(this.host.root, model, layout.metrics);
    applyTicketCssVars(this.host.scroll, layout.metrics);
    applyCellBoxCssVars(this.host.scroll, model, layout.metrics);
    applyTicketCssVars(this.host.atlasHost, layout.metrics);
    applyCellBoxCssVars(this.host.atlasHost, model, layout.metrics);

    this.measureScrollGeometry();
    this.rebuildSlots();
    const height = contentHeight(this.tickets.length, layout);
    const count = this.tickets.length;
    const bandW = contentWidth(layout);
    this.host.content.style.width = bandW > 0 ? `${bandW}px` : "";
    /* Absolute canvas/DOM do not contribute to scroll height — FM uses in-flow tickets + CSS spacer padding. */
    this.host.content.style.boxSizing = "content-box";
    this.host.content.style.height = count > 0 && height > 0 ? `${height}px` : "";
    this.host.content.style.minHeight = "";

    this.snapFrameOrigin();

    if (layoutChanged) {
      this.host.domHost.style.visibility = "hidden";
    }
    if (motionGeometryChanged) {
      this.dom?.cancelAllMotion();
    }

    let pendingHide: number[] = [];
    if (opts.syncDomBand) {
      pendingHide = this.syncDom(undefined, layoutChanged);
      this.finishDomRebind(pendingHide);
    }
    this.dom?.refreshLayout();
    if (layoutChanged) {
      this.host.domHost.style.visibility = "visible";
    }

    if (opts.syncCanvasCatalog && this.canvasReady) this.syncCanvas();

    this.updateStats();

    this.prevLayoutKey = key;

    if (layoutChanged) {
      this.resizeLogT0 = performance.now();
      this.resizeLog("layout-change", {
        fromKey: this.prevLayoutKey || "(initial)",
        toKey: key,
        preset: layout.metrics.id,
        cardW: layout.cardWidth,
        columns: layout.columns,
        canvasReady: this.canvasReady,
        prevPaintKey: this.prevPaintLayoutKey,
      });
      this.lastBandFingerprint = "";
      if (this.prevPaintLayoutKey) {
        this.hideCanvas();
        this.canvas?.clear();
        this.canvasReady = false;
        this.atlasGen += 1;
      }
      if (this.canvasReady || this.prevPaintLayoutKey) {
        this.scheduleCanvasAfterResize(true);
      }
    } else if (this.canvasReady) {
      this.scheduleCanvasAfterResize();
    }

  }

  private rebuildSlots(): void {
    const layout = getActiveLayout();
    this.slots = buildSlots(
      this.tickets,
      layout.columns,
      layout.cardWidth,
      layout.cardHeight,
      layout.gap,
      layout.gap,
    );
    this.ticketsById = new Map(this.tickets.map((t) => [t.id, t]));
  }

  /** Sort / reorder only — no preset or pool geometry churn. */
  private applySlotsAfterReorder(): void {
    this.rebuildSlots();
    const layout = getActiveLayout();
    const height = contentHeight(this.tickets.length, layout);
    const count = this.tickets.length;
    const bandW = contentWidth(layout);
    this.host.content.style.width = bandW > 0 ? `${bandW}px` : "";
    this.host.content.style.height = count > 0 && height > 0 ? `${height}px` : "";
  }

  private snapFrameOrigin(): void {
    snapCatalogFrameOrigin(this.host.catalogFrame, this.host.content, this.host.scroll);
  }

  private scheduleCanvasAfterResize(forceRebuild = false): void {
    if (forceRebuild) this.resizeCanvasForcePending = true;
    if (this.resizeCanvasTimer) window.clearTimeout(this.resizeCanvasTimer);
    this.resizeCanvasTimer = window.setTimeout(() => {
      this.resizeCanvasTimer = 0;
      const force = this.resizeCanvasForcePending;
      this.resizeCanvasForcePending = false;
      this.flushCanvasAfterResize(force);
    }, RESIZE_CANVAS_SETTLE_MS);
  }

  private flushCanvasAfterResize(forceRebuild: boolean): void {
    this.measureScrollGeometry();
    const key = catalogLayoutCacheKey(getActiveLayout());

    if (forceRebuild || key !== this.prevPaintLayoutKey) {
      this.resizeLog("canvas-settle", {
        forceRebuild,
        paintKey: key,
        prevPaintKey: this.prevPaintLayoutKey,
        canvasReady: this.canvasReady,
      });
      this.prevPaintLayoutKey = key;
      if (forceRebuild) {
        this.canvas?.clear();
      }
      if (!this.canvasReady) {
        this.resizeLog("canvas-path", { path: "schedule-atlas-warm", paintKey: key });
        this.scheduleAtlasWarm();
      } else {
        this.resizeLog("canvas-path", { path: "layout-resync-ready", paintKey: key });
        const pendingHide = this.syncDom();
        this.finishDomRebind(pendingHide);
        this.syncCanvas();
        this.revealCanvas();
        this.stampBandFingerprintAtRest();
      }
      return;
    }

    this.resizeLog("canvas-path", { path: "same-key-reveal", paintKey: key });
    this.revealCanvas();
  }

  private startCanvasWarm(): void {
    const layoutNow = getActiveLayout();
    const warmKey = catalogLayoutCacheKey(layoutNow);
    const gen = ++this.atlasGen;
    this.warmLogT0 = performance.now();
    this.warmLog("warm-start");
    void (async () => {
      try {
        await ensureTicketFontsForLayout(layoutNow.metrics);
        this.warmLog("fonts-done");
        if (gen !== this.atlasGen) {
          this.resizeLog("warm-aborted", { reason: "atlasGen-after-fonts", warmGen: gen });
          return;
        }
        if (catalogLayoutCacheKey(layoutNow) !== warmKey) {
          this.resizeLog("warm-aborted", { reason: "layout-key-mismatch-after-fonts", warmKey });
          return;
        }
        await ensureCatalogSvgAtlasWarm(layoutNow, warmKey, (phase) => this.warmLog(phase));
        this.warmLog("atlas-done");
        if (gen !== this.atlasGen) {
          this.resizeLog("warm-aborted", { reason: "atlasGen-after-atlas", warmGen: gen });
          return;
        }
        if (catalogLayoutCacheKey(layoutNow) !== warmKey) {
          this.resizeLog("warm-aborted", { reason: "layout-key-mismatch-after-atlas", warmKey });
          return;
        }
        prewarmCatalogSvgPaintJit(layoutNow);
        this.canvasReady = true;
        this.warmLog("canvas-ready");
        this.prevPaintLayoutKey = catalogLayoutCacheKey(layoutNow);
        this.syncCellBoxCssVarsOnHosts();
        this.dom?.refreshSvgDomOverlays();
        const pendingHide = this.syncDom();
        this.finishDomRebind(pendingHide);
        this.syncCanvas();
        this.revealCanvas();
        this.stampBandFingerprintAtRest();
        this.armLandscapePrewarm();
        this.updateStats();
      } catch (err) {
        console.error("[catalog-warm] failed for layout", layoutNow.metrics.id, err);
      }
    })();
  }

  /** Landscape atlas prewarm — first rotation or idle, not immediately after portrait warm. */
  private armLandscapePrewarm(): void {
    if (this.landscapePrewarmArmed) return;
    this.landscapePrewarmArmed = true;
    const run = () => this.scheduleLandscapePrewarm();
    window.addEventListener("orientationchange", run, { once: true });
    if (window.requestIdleCallback) {
      window.requestIdleCallback(run, { timeout: 5000 });
    } else {
      window.setTimeout(run, 5000);
    }
  }

  private scheduleLandscapePrewarm(): void {
    if (this.landscapePrewarmScheduled) return;
    this.landscapePrewarmScheduled = true;
    const host = this.host.prewarmHost;
    if (!host || window.innerWidth > window.innerHeight) return;
    const run = () => {
      const active = getActiveLayout();
      if (!active.isMobile) return;
      // Rotated layout viewport → GameGrid landscape band (518, or 458 compressed, minus buttons).
      const vw = window.innerHeight;
      const vh = window.innerWidth;
      const compressed = vh < 320 || vw < 360;
      const bandWidth = Math.floor(Math.min(compressed ? 458 : 518, vw - (compressed ? 104 : 112)));
      const metrics = resolveTicketMetrics(vw, vh);
      const next = resolveCatalogLayout(true, true, bandWidth, metrics);
      if (catalogLayoutCacheKey(next) === catalogLayoutCacheKey(active)) return;
      void this.warmLayoutBitmaps(host, next);
    };
    const deferMs = 2500;
    if (window.requestIdleCallback) {
      window.requestIdleCallback(() => run(), { timeout: deferMs });
    } else {
      window.setTimeout(run, deferMs);
    }
  }

  private async warmLayoutBitmaps(host: HTMLElement, layout: CatalogLayout): Promise<void> {
    const model = resolveLiveCellBoxModel(layout, activeDpr());
    applyTicketCssVars(host, layout.metrics);
    applyCellBoxCssVars(host, model, layout.metrics);
    try {
      await warmCatalogAtlasForPrewarm(layout);
    } catch (err) {
      console.warn("[catalog-prewarm] optional layout warm failed", layout.metrics.id, err);
    }
  }

  /** Fingerprint for the DOM band — skip work when scrollend fires with the same band. */
  private bandFingerprint(dom: readonly TicketSlot[]): string {
    if (dom.length === 0) return "";
    const first = dom[0]!.id;
    const last = dom[dom.length - 1]!.id;
    return `${first}|${last}|${dom.length}`;
  }

  private enqueueDomHide(indices: readonly number[]): void {
    if (indices.length === 0) return;
    this.domHideQueue.push(...indices);
  }

  private flushDomHideQueue(): void {
    if (this.domHideQueue.length === 0) return;
    const batch = this.domHideQueue;
    this.domHideQueue = [];
    this.dom?.hideEvictedSlots(batch);
  }

  /**
   * After scroll stops: bind the new DOM band, then paint canvas holes one tile
   * per frame. Never resumes the canvas before that skip set is applied.
   */
  private settleBandAtRest(): void {
    const gen = ++this.settleGen;
    this.settleInFlight = true;
    const scrollTop = this.host.scroll.scrollTop;
    const viewH = this.host.scroll.clientHeight;
    const { dom } = this.bandForScroll(scrollTop);
    const fp = this.bandFingerprint(dom);
    const bandChanged = fp !== this.lastBandFingerprint;
    const ids = new Set(dom.map((s) => s.id));

    const resumeCanvas = (pendingHide: readonly number[]) => {
      if (gen !== this.settleGen) {
        this.enqueueDomHide(pendingHide);
        return;
      }
      this.scrollMotionActive = false;
      this.updateDomCompositorLayer();
      this.enqueueDomHide(pendingHide);
      const canvas = this.canvas;
      const hidden = this.host.canvasHost.style.visibility === "hidden";
      if (!this.canvasReady || !canvas || hidden) {
        canvas?.releaseScrollRetainHold();
        this.settleInFlight = false;
        this.flushDomHideQueue();
        return;
      }
      void canvas.resumeWithBand(ids, { scrollTop, viewH }).then(() => {
        if (gen !== this.settleGen) return;
        this.settleInFlight = false;
        this.flushDomHideQueue();
      });
    };

    if (!bandChanged) {
      resumeCanvas([]);
      return;
    }

    // Show the new DOM band for one frame before the first tile upload.
    requestAnimationFrame(() => {
      if (gen !== this.settleGen) return;
      const pendingHide = this.syncDom(dom);
      this.updateStats();
      this.lastBandFingerprint = fp;
      if (!this.canvas) {
        this.dom?.hideEvictedSlots(pendingHide);
        this.scrollMotionActive = false;
        this.updateDomCompositorLayer();
        this.settleInFlight = false;
        return;
      }
      requestAnimationFrame(() => {
        resumeCanvas(pendingHide);
      });
    });
  }

  /** Defer band work to idle so scrollend stays off the critical path. */
  private queueBandResync(): void {
    const gen = ++this.bandResyncGen;
    const run = () => {
      if (gen !== this.bandResyncGen) return;
      this.settleBandAtRest();
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 300 });
    } else {
      setTimeout(run, 0);
    }
  }

  /**
   * Scroll gesture: compositor + top-fade only. Tile eviction and DOM/canvas
   * band work wait for scrollend (+ SCROLL_BAND_SETTLE_MS).
   */
  private onScrollWhileMoving(): void {
    if (this.scrollSettleTimer) {
      window.clearTimeout(this.scrollSettleTimer);
      this.scrollSettleTimer = 0;
    }
    if (this.settleInFlight) {
      this.settleGen += 1;
      this.settleInFlight = false;
    }
    this.cancelGestureCanvasForScroll();
    const scroll = this.host.scroll;
    if (this.canvasReady && this.canvas) {
      this.canvas.holdRetainBudgetForScroll(scroll.scrollTop, scroll.clientHeight);
    }
    if (this.scrollMotionActive) return;
    this.scrollMotionActive = true;
    this.updateDomCompositorLayer();
    if (this.canvasReady) this.canvas?.pause();
  }

  /** DOM band + canvas skip holes — only after scroll motion settles (300ms). */
  private onScrollSettled(): void {
    this.setOverflowingStart(this.host.scroll.scrollTop > SCROLL_TOP_EPSILON_PX);
    this.settleBandAtRest();
  }

  private scheduleScrollSettledWork(): void {
    if (this.scrollSettleTimer) window.clearTimeout(this.scrollSettleTimer);
    const settledTop = this.host.scroll.scrollTop;
    this.scrollSettleTimer = window.setTimeout(() => {
      this.scrollSettleTimer = 0;
      if (Math.abs(this.host.scroll.scrollTop - settledTop) > SCROLL_TOP_EPSILON_PX) return;
      this.onScrollSettled();
    }, SCROLL_BAND_SETTLE_MS);
  }

  private bindScroll(): void {
    const container = this.host.scroll;
    let legacySettleTimer = 0 as number;
    let maskRaf = 0;

    this.setOverflowingStart(container.scrollTop > SCROLL_TOP_EPSILON_PX);

    const onScrollEnd = () => {
      this.scheduleScrollSettledWork();
    };

    // Per-frame work is one scrollTop read and a class flip only when the top fade changes.
    const onScrollWhileMoving = () => {
      this.onScrollWhileMoving();
      if (maskRaf) return;
      maskRaf = requestAnimationFrame(() => {
        maskRaf = 0;
        this.setOverflowingStart(container.scrollTop > SCROLL_TOP_EPSILON_PX);
      });
    };

    const onScrollLegacy = () => {
      onScrollWhileMoving();
      if (legacySettleTimer) window.clearTimeout(legacySettleTimer);
      const settledTop = container.scrollTop;
      legacySettleTimer = window.setTimeout(() => {
        legacySettleTimer = 0;
        if (Math.abs(container.scrollTop - settledTop) > SCROLL_TOP_EPSILON_PX) return;
        onScrollEnd();
      }, SCROLL_BAND_SETTLE_MS);
    };

    if ("onscrollend" in globalThis) {
      container.addEventListener("scroll", onScrollWhileMoving, { passive: true });
      container.addEventListener("scrollend", onScrollEnd, { passive: true });
    } else {
      container.addEventListener("scroll", onScrollLegacy, { passive: true });
    }

    this.scrollCleanup = () => {
      if ("onscrollend" in globalThis) {
        container.removeEventListener("scroll", onScrollWhileMoving);
        container.removeEventListener("scrollend", onScrollEnd);
      } else {
        container.removeEventListener("scroll", onScrollLegacy);
      }
      if (legacySettleTimer) window.clearTimeout(legacySettleTimer);
      if (maskRaf) cancelAnimationFrame(maskRaf);
      if (this.scrollSettleTimer) window.clearTimeout(this.scrollSettleTimer);
    };
  }

  /** Top fade mask (`ticketCatalog_isOverflowingStart`), written only when it flips. */
  private setOverflowingStart(on: boolean): void {
    if (on === this.overflowingStart) return;
    this.overflowingStart = on;
    this.host.scroll.classList.toggle("ticketCatalog_isOverflowingStart", on);
  }

  /** Layer promotion on the DOM pool only while scrolling or running WAAPI. */
  private updateDomCompositorLayer(): void {
    const promote = this.scrollMotionActive || this.domMotions > 0;
    this.host.domHost.classList.toggle("catalog__dom_motion", promote);
  }

  private bindViewport(): void {
    // Presets key off innerWidth × innerHeight, so a height-only resize can change metrics too.
    const onViewportChange = () => {
      this.hideCanvas();
      this.resizeLogT0 = performance.now();
      this.resizeLog("viewport-resize", { innerW: window.innerWidth, innerH: window.innerHeight });
      if (this.orientationTimer) window.clearTimeout(this.orientationTimer);
      this.orientationTimer = window.setTimeout(() => {
        this.orientationTimer = 0;
        this.resizeLog("viewport-settle", { ms: Math.round(performance.now() - this.resizeLogT0) });
        this.measureScrollGeometry();
        this.applyLayout({ syncDomBand: true, syncCanvasCatalog: this.canvasReady });
      }, RESIZE_CANVAS_SETTLE_MS);
    };
    const onOrientation = onViewportChange;

    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onOrientation);
    const mq = window.matchMedia("(orientation: portrait)");
    mq.addEventListener?.("change", onOrientation);

    this.resizeCleanup = () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", onOrientation);
      mq.removeEventListener?.("change", onOrientation);
      if (this.orientationTimer) window.clearTimeout(this.orientationTimer);
    };
  }

  private bindResizeObserver(): void {
    if (typeof ResizeObserver === "undefined") return;
    this.ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      let inlineSize: number | undefined;
      if (entry) {
        const box = entry.contentBoxSize;
        if (box.length > 0 && Number.isFinite(box[0]!.inlineSize)) {
          inlineSize = box[0]!.inlineSize;
        } else if (Number.isFinite(entry.contentRect.width)) {
          inlineSize = entry.contentRect.width;
        }
      }
      this.onCatalogFrameResize(inlineSize);
    });
    this.ro.observe(this.host.catalogFrame);
    // The toolbar's text height places the frame; re-snap when it changes.
    this.originRo = new ResizeObserver(() => this.snapFrameOrigin());
    this.originRo.observe(this.host.ui.toolbar);
  }

  private onTicketsChanged(added: string[]): void {
    if (this.tickets.length === 0) {
      this.canvas?.clear();
      this.syncDom();
      this.updateStats();
      return;
    }

    for (const id of added) this.knownIds.add(id);
    const animate =
      added.length > 0 && added.length < APPEAR_MAX_TICKETS && !prefersReducedMotion();
    this.freshIds = new Set(animate ? added.slice(-TICKET_ANIMATED_COUNT) : []);
    // Existing cards snap to their reflowed slots (flex append); only new cards animate.
    this.syncDom();
    const bulkScroll = added.length >= APPEAR_MAX_TICKETS;

    let scheduleSmoothScroll: (() => void) | undefined;
    if (added.length > 0) {
      if (this.scrollTimer) window.clearTimeout(this.scrollTimer);
      if (this.bulkScrollResyncTimer) window.clearTimeout(this.bulkScrollResyncTimer);

      const delay = animate ? APPEAR_MS : 0;
      const runSmoothScrollToBottom = () => {
        void (async () => {
          this.scrollTimer = 0;
          const maxScroll = Math.max(
            0,
            this.host.scroll.scrollHeight - this.host.scroll.clientHeight,
          );
          if (this.canvasReady && this.canvas) {
            await this.canvas.flushEntireCatalog();
            this.canvas.primeViewport(maxScroll, this.host.scroll.clientHeight);
          }
          this.host.scroll.scrollTo({ top: maxScroll, behavior: "smooth" });
          if (bulkScroll) {
            this.bulkScrollResyncTimer = window.setTimeout(() => {
              this.bulkScrollResyncTimer = 0;
              this.lastBandFingerprint = "";
              this.queueBandResync();
            }, 900);
          }
        })();
      };

      scheduleSmoothScroll = () => {
        this.scrollTimer = window.setTimeout(runSmoothScrollToBottom, delay);
      };
    }

    requestAnimationFrame(() => {
      if (added.length === 0) return;
      if (this.canvasReady && this.canvas) {
        this.syncCanvas();
        void this.canvas?.flushEntireCatalog();
        scheduleSmoothScroll?.();
      }
    });
  }

  private addCount(count: number): void {
    const room = MAX_TICKETS - this.tickets.length;
    if (room <= 0) return;
    const prevLen = this.tickets.length;
    const next = [
      ...this.tickets,
      ...createTickets(Math.min(count, room)),
    ];
    const added = next.slice(prevLen).map((t) => t.id);
    this.tickets = next;
    this.applyLayout({ syncDomBand: false, syncCanvasCatalog: false });
    this.onTicketsChanged(added);
    this.updateStats();
  }

  /** Fortunamania `reset`: drop every card at once and pin to the top (no fade). */
  private reset(): void {
    this.tickets = [];
    this.knownIds = new Set();
    this.freshIds = new Set();
    this.drawGen += 1;
    if (this.shuffleTimer) window.clearTimeout(this.shuffleTimer);
    this.shuffleTimer = 0;
    if (this.roundEndTimer) window.clearTimeout(this.roundEndTimer);
    this.roundEndTimer = 0;
    this.drawnBalls = [];
    this.drawRound = 0;
    this.lastDraw = "";
    this.dom?.clearMotion();
    this.canvas?.clear();
    this.applyLayout({ syncDomBand: true, syncCanvasCatalog: false });
    this.host.scroll.scrollTop = 0;
    this.setOverflowingStart(false);
    this.updateStats();
  }

  private rebuildCanvas(): void {
    this.prevPaintLayoutKey = "";
    this.canvasReady = false;
    this.startCanvasWarm();
  }

  private refreshStates(): void {
    this.canvas?.refresh();
    this.syncDom();
  }

  private drawBall(): void {
    if (this.tickets.length === 0 || this.drawRound >= DRAW_ROUND_COUNT) return;
    const spec = DRAW_ROUNDS[this.drawRound]!;
    const ball = pickDrawBall(
      this.tickets,
      this.drawnBalls,
      new Set(this.bandForScroll(this.host.scroll.scrollTop).dom.map((s) => s.id)),
    );
    if (ball == null) return;
    this.drawnBalls.push(ball);
    const nextRound = this.drawRound + 1;
    const hits = applyDrawnBall(this.tickets, ball, spec.multiplier);
    const lastBall = nextRound >= DRAW_ROUND_COUNT;
    this.drawRound = nextRound;
    this.lastDraw =
      spec.multiplier > 0
        ? `${ball} · ${spec.multiplier}× · ${hits.length} tickets`
        : `${ball} · dab · ${hits.length} tickets`;

    this.syncDom();
    const changedIds = new Set(hits.map((h) => h.id));
    const bound = this.dom?.boundIds() ?? new Set<string>();
    const domGesture = hits.some((h) => bound.has(h.id));
    const gestureMs = drawGestureMs(
      hits,
      this.ticketsById,
      resolveTicketSparklePlan(getActiveLayout()).settleMs,
    );
    if (this.shuffleTimer) window.clearTimeout(this.shuffleTimer);
    this.shuffleTimer = 0;
    const gen = ++this.drawGen;
    // The gesture starts on the next frame, after the canvas suspend drops the tiles,
    // and WAAPI dates its shine from the frame after that. So the sort and the round
    // result hang off the gesture's own end rather than a clock started here, which
    // on a phone comes due while the shine is still sweeping.
    requestAnimationFrame(() => {
      let gesture: Promise<void> | null = null;
      if (domGesture && this.canvasReady) {
        this.beginGestureCanvasSuspend();
        gesture = this.dom?.playDraws(hits) ?? null;
        this.scheduleGestureCanvasRestore(gestureMs + 50);
      } else {
        this.canvas?.refreshForTicketIds(changedIds);
      }
      // Fortunamania sorts only while the catalog is scrolled to the top.
      const plan =
        this.host.scroll.scrollTop <= SCROLL_TOP_EPSILON_PX
          ? resolveShufflePlan(gestureMs)
          : null;
      this.afterDrawGesture(gesture, plan?.delayMs ?? gestureMs, () => {
        if (gen !== this.drawGen) return;
        if (plan) this.runShuffle(plan.durationMs);
        // The round result (gold or green) lands after the sort, not under it.
        if (lastBall) {
          this.roundEndTimer = window.setTimeout(() => {
            this.roundEndTimer = 0;
            this.endRound();
          }, (plan?.durationMs ?? 0) + 100);
        }
      });
    });
    this.updateStats();
  }

  /** Sixth ball settled: every ticket that did not pay turns green (no animation). */
  private endRound(): void {
    finishRound(this.tickets);
    this.syncDom();
    this.canvas?.refreshForTicketIds(new Set(this.tickets.map((t) => t.id)));
  }

  /**
   * Runs `after` once the draw gesture's animations have ended. With no gesture to
   * wait on — every hit ticket is on canvas — `nominalMs` keeps the game's rhythm.
   * Otherwise the timer is a watchdog: a paused timeline must not strand the round
   * without its sort or its result.
   */
  private afterDrawGesture(
    gesture: Promise<void> | null,
    nominalMs: number,
    after: () => void,
  ): void {
    let ran = false;
    const run = () => {
      if (ran) return;
      ran = true;
      if (this.shuffleTimer) {
        window.clearTimeout(this.shuffleTimer);
        this.shuffleTimer = 0;
      }
      after();
    };
    const waitMs = gesture ? nominalMs + GESTURE_SETTLE_GRACE_MS : nominalMs;
    this.shuffleTimer = window.setTimeout(run, waitMs);
    if (gesture) void gesture.then(run);
  }

  /** `shuffleAnimationDelayed` body: reorder, rebind the band, FLIP every mover together. */
  private runShuffle(durationMs: number): void {
    const sorted = sortTickets(this.tickets);
    if (sorted.every((ticket, index) => ticket === this.tickets[index])) return;
    const from = new Map(this.slots.map((slot) => [slot.id, { x: slot.x, y: slot.y }]));
    this.tickets = sorted;
    if (this.canvasReady) this.beginGestureCanvasSuspend(false);
    this.applySlotsAfterReorder();
    const scroll = this.host.scroll;
    const band = this.bandForScroll(scroll.scrollTop).dom;
    const targets = new Map(this.slots.map((slot) => [slot.id, { x: slot.x, y: slot.y }]));
    this.dom?.rebindForShuffle(band, this.ticketsById, from);
    if (this.canvasReady && this.canvas) {
      this.canvas.setCatalog(this.slots, this.ticketsById, this.domSkipIds());
    }
    this.dom?.playMoves(from, band, durationMs, targets, {
      scrollTop: scroll.scrollTop,
      viewH: scroll.clientHeight,
      cardHeight: getActiveLayout().cardHeight,
    });
    this.scheduleGestureCanvasRestore(durationMs + 50);
  }

  private clearDraws(): void {
    this.drawGen += 1;
    if (this.shuffleTimer) window.clearTimeout(this.shuffleTimer);
    this.shuffleTimer = 0;
    if (this.roundEndTimer) window.clearTimeout(this.roundEndTimer);
    this.roundEndTimer = 0;
    for (const ticket of this.tickets) {
      ticket.hits = [];
      ticket.multipliers = {};
      ticket.win = "";
      ticket.disabled = false;
    }
    this.drawnBalls = [];
    this.drawRound = 0;
    this.lastDraw = "";
    this.dom?.clearMotion();
    this.tickets = [...this.tickets].sort((a, b) => Number(a.no) - Number(b.no));
    this.applyLayout({ syncDomBand: true, syncCanvasCatalog: true });
    this.refreshStates();
    this.updateStats();
  }

  private updateStats(): void {
    const { ui } = this.host;
    const layout = getActiveLayout();
    const tiles = this.canvas?.tileCount ?? 0;
    const drawLabel =
      this.drawRound >= DRAW_ROUND_COUNT
        ? "6/6 drawn"
        : `Draw ${this.drawRound + 1}/6${
            DRAW_ROUNDS[this.drawRound]!.multiplier > 0
              ? ` · ${DRAW_ROUNDS[this.drawRound]!.multiplier}×`
              : ""
          }`;
    const drawDisabled =
      this.tickets.length === 0 || this.drawRound >= DRAW_ROUND_COUNT;
    const dirtyKey = [
      layout.metrics.id,
      layout.columns,
      layout.cardWidth,
      layout.cardHeight,
      this.tickets.length,
      tiles,
      this.canvasReady,
      this.domCount,
      this.poolSize,
      this.lastDraw,
      drawLabel,
      drawDisabled,
    ].join("|");
    if (dirtyKey === this.statsDirtyKey) return;
    this.statsDirtyKey = dirtyKey;

    ui.layoutStat.textContent = "";
    ui.layoutStat.append(
      "layout ",
      Object.assign(document.createElement("strong"), {
        textContent: `${layout.metrics.id} · ${layout.columns}col · ${layout.cardWidth}×${layout.cardHeight}`,
      }),
    );
    ui.ticketStat.textContent = "";
    ui.ticketStat.append(
      "tickets ",
      Object.assign(document.createElement("strong"), {
        textContent: `${this.tickets.length}/${MAX_TICKETS}`,
      }),
    );
    ui.tileStat.textContent = "";
    ui.tileStat.append("tiles ", Object.assign(document.createElement("strong"), { textContent: String(tiles) }));
    ui.canvasStat.textContent = "";
    ui.canvasStat.append(
      "canvas ",
      Object.assign(document.createElement("strong"), {
        textContent: this.canvasReady ? "ready" : "…",
      }),
    );
    ui.domStat.textContent = "";
    ui.domStat.append(
      "dom ",
      Object.assign(document.createElement("strong"), {
        textContent: `${this.domCount}/${this.poolSize}`,
      }),
    );

    if (this.lastDraw) {
      ui.lastDraw.hidden = false;
      ui.lastDraw.textContent = `last ball ${this.lastDraw}`;
    } else {
      ui.lastDraw.hidden = true;
    }

    ui.drawBtn.textContent = drawLabel;
    ui.drawBtn.disabled = drawDisabled;

    for (const btn of ui.ticketAdds.querySelectorAll<HTMLButtonElement>("[data-add-count]")) {
      btn.disabled = this.tickets.length >= MAX_TICKETS;
    }
  }

  private warmLog(label: string): void {
    console.info("[catalog-warm]", label, { ms: Math.round(performance.now() - this.warmLogT0) });
  }

  /** Filter DevTools on `[catalog-resize]` — POC uses frame RO + viewport settle (no FM css-only path). */
  private resizeLog(label: string, detail: Record<string, unknown> = {}): void {
    console.info("[catalog-resize]", label, {
      ms: this.resizeLogT0 ? Math.round(performance.now() - this.resizeLogT0) : 0,
      atlasGen: this.atlasGen,
      canvasReady: this.canvasReady,
      ...detail,
    });
  }
}
