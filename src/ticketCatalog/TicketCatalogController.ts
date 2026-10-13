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
  getActiveLayout,
  readCatalogCardHeight,
  readCatalogSpacerRows,
  resolveCatalogLayout,
  setActiveLayout,
  type CatalogLayout,
} from "./layout/catalogLayout";
import { animateRemovedTickets, takeGestureDelay } from "./animation/catalogAnimations";
import {
  bindCatalogScrollbarDrag,
  syncCatalogScrollbar,
  type CatalogScrollbarRefs,
} from "./syncCatalogScrollbar";
import { resolveLiveCellBoxModel } from "./canvas/atlas/cellAtlas";
import { ensureTicketFontsForLayout } from "./layout/ticketFont";
import {
  ensureCatalogSvgAtlasWarm,
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
  finishRound,
  pickDrawBall,
  shuffleDelayMs,
  sortTickets,
  type Ticket,
  type TicketSlot,
} from "./model/tickets";
import {
  applyTicketCssVars,
  readTicketMetricsFromCss,
  resolvePresetFromViewport,
} from "./model/ticketPresets";
import type { ToolbarRefs } from "./buildToolbar";

const RESIZE_CANVAS_SETTLE_MS = 300;
const SCROLL_TOP_EPSILON_PX = 1;
const MOBILE_MQ = "(max-width: 1023px), (max-height: 499px)";

function layoutCacheKey(layout: CatalogLayout): string {
  return `${layout.metrics.id}|${layout.cardWidth}|${layout.columns}|${layout.cardHeight}`;
}

export type TicketCatalogControllerHost = {
  root: HTMLElement;
  ui: ToolbarRefs;
  catalogFrame: HTMLElement;
  ticketCatalogHost: HTMLElement;
  scrollbarLane: HTMLElement;
  scrollbarThumb: HTMLElement;
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
  private prevSlots = new Map<string, { x: number; y: number }>();
  private shuffleMs = 400;
  private shuffleTimer = 0;
  private scrollTimer = 0;
  private resizeCanvasTimer = 0;
  private warmTimer = 0;

  private scrollCleanup: (() => void) | null = null;
  private resizeCleanup: (() => void) | null = null;
  private ro: ResizeObserver | null = null;
  private bandResyncGen = 0;
  private lastBandFingerprint = "";
  private bulkScrollResyncTimer = 0;
  private resizeCanvasForcePending = false;
  private scrollbarDragCleanup: (() => void) | null = null;
  private scrollbarRo: ResizeObserver | null = null;

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
    this.bindScrollbarChrome();
    this.bindViewport();
    this.bindResizeObserver();

    this.warmTimer = window.setTimeout(() => {
      this.warmTimer = 0;
      this.startCanvasWarm();
    }, 120);
  }

  destroy(): void {
    if (this.warmTimer) window.clearTimeout(this.warmTimer);
    if (this.resizeCanvasTimer) window.clearTimeout(this.resizeCanvasTimer);
    if (this.scrollTimer) window.clearTimeout(this.scrollTimer);
    if (this.bulkScrollResyncTimer) window.clearTimeout(this.bulkScrollResyncTimer);
    if (this.shuffleTimer) window.clearTimeout(this.shuffleTimer);
    this.scrollCleanup?.();
    this.scrollbarDragCleanup?.();
    this.scrollbarDragCleanup = null;
    this.scrollbarRo?.disconnect();
    this.scrollbarRo = null;
    this.resizeCleanup?.();
    this.ro?.disconnect();
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
    this.dom.mount();
    this.canvas.mount();
    this.poolSize = poolSize;
  }

  private resolvePoolSize(): number {
    const metrics = readTicketMetricsFromCss(this.host.scroll);
    return domPoolSize(metrics.id.startsWith("mobile"));
  }

  private readMetrics() {
    return readTicketMetricsFromCss(this.host.scroll);
  }

  private resolveLayout(): CatalogLayout {
    const metrics = this.readMetrics();
    const isMobile = window.matchMedia(MOBILE_MQ).matches;
    const isLandscape = window.matchMedia("(orientation: landscape)").matches;
    return resolveCatalogLayout(isMobile, isLandscape, this.availableWidth, metrics);
  }

  private measureHostWidth(): void {
    // Fortunamania: column math uses full ticketBox width (1001 → 5×197 + 4×4). Scrollbar lane is outside the box via host CSS.
    this.availableWidth = Math.max(0, this.host.catalogFrame.clientWidth);
    const cardHeight = readCatalogCardHeight(this.host.scroll);
    this.host.scroll.style.setProperty("--catalog-card-height", `${cardHeight}px`);
  }

  /** ResizeObserver — apply layout in the same frame (avoid one frame of stale card width). */
  private onCatalogFrameResize(): void {
    this.measureScrollGeometry();
    this.ensurePools();
    this.applyLayout({ syncDomBand: true, syncCanvasCatalog: false });
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
      this.poolSize,
    );
  }

  /** Skip set for canvas: ids that actually have a DOM card (after rebind). */
  private domSkipIds(): Set<string> {
    const dom = this.dom;
    if (dom?.isReady) {
      const bound = dom.boundIds();
      if (bound.size > 0) return new Set(bound);
    }
    return new Set(
      this.bandForScroll(this.host.scroll.scrollTop).dom.map((s) => s.id),
    );
  }

  private syncDom(domSlots?: readonly TicketSlot[]): number[] {
    const dom = this.dom;
    if (!dom?.isReady) return [];
    const slots =
      domSlots ?? this.bandForScroll(this.host.scroll.scrollTop).dom;
    const fresh = this.freshIds;
    this.freshIds = new Set();
    const pendingHide = dom.rebind(slots, this.ticketsById, fresh);
    for (const id of fresh) this.knownIds.add(id);
    this.domCount = slots.length;
    this.updateStats();
    return pendingHide;
  }

  private syncCanvas(): void {
    const canvas = this.canvas;
    if (!canvas?.isReady) return;
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

  private applyLayout(opts: { syncDomBand: boolean; syncCanvasCatalog: boolean }): void {
    this.measureHostWidth();
    const layout = this.resolveLayout();
    const key = layoutCacheKey(layout);
    const layoutChanged = key !== this.prevLayoutKey;

    setActiveLayout(layout);
    const model = resolveLiveCellBoxModel(layout);
    setLiveCellBoxModel(model);
    applyCellBoxCssVars(this.host.root, model, layout.metrics);
    applyTicketCssVars(this.host.atlasHost, layout.metrics);
    applyCellBoxCssVars(this.host.atlasHost, model, layout.metrics);

    this.rebuildSlots();
    const height = contentHeight(this.tickets.length, layout);
    const spacerRows = readCatalogSpacerRows(this.host.scroll);
    const spacerPx =
      this.tickets.length > 0 ? spacerRows * (layout.cardHeight + layout.gap) : 0;

    const gridW = contentWidth(layout);
    this.host.content.style.width = gridW > 0 ? `${gridW}px` : "100%";
    this.host.content.style.height = `${height + spacerPx}px`;
    this.host.content.style.minHeight = height > 0 ? "" : "80px";

    if (layoutChanged) {
      this.host.domHost.style.visibility = "hidden";
    }
    this.dom?.cancelAllMotion();
    this.measureScrollGeometry();

    if (opts.syncDomBand) this.syncDom();
    this.dom?.refreshLayout();
    if (layoutChanged) {
      this.host.domHost.style.visibility = "visible";
    }

    if (opts.syncCanvasCatalog && this.canvasReady) this.syncCanvas();

    this.updateStats();

    this.prevLayoutKey = key;
    this.syncScrollbarChrome();

    if (layoutChanged) {
      if (this.prevPaintLayoutKey && this.canvasReady) {
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
    const key = layoutCacheKey(getActiveLayout());

    if (forceRebuild || key !== this.prevPaintLayoutKey) {
      this.prevPaintLayoutKey = key;
      if (!this.canvasReady) {
        this.startCanvasWarm();
      } else {
        this.syncCanvas();
        this.revealCanvas();
      }
      return;
    }

    this.revealCanvas();
  }

  private startCanvasWarm(): void {
    const layoutNow = getActiveLayout();
    const gen = ++this.atlasGen;
    void (async () => {
      try {
        await ensureTicketFontsForLayout(layoutNow.metrics);
        if (gen !== this.atlasGen) return;
        await ensureCatalogSvgAtlasWarm(layoutNow);
        if (gen !== this.atlasGen) return;
        this.canvasReady = true;
        this.prevPaintLayoutKey = layoutCacheKey(layoutNow);
        this.syncCellBoxCssVarsOnHosts();
        this.dom?.refreshSvgDomOverlays();
        this.syncCanvas();
        this.syncDom();
        this.revealCanvas();
        this.scheduleLandscapePrewarm();
        this.updateStats();
      } catch (err) {
        console.error("[catalog-warm] failed for layout", layoutNow.metrics.id, err);
      }
    })();
  }

  private scheduleLandscapePrewarm(): void {
    const host = this.host.prewarmHost;
    if (!host || window.innerWidth > window.innerHeight) return;
    const run = () => {
      const w = window.innerHeight;
      const h = window.innerWidth;
      const metrics = resolvePresetFromViewport(w, h);
      const gap = 4;
      const cols = metrics.id.startsWith("mobile") ? 3 : 5;
      const minW = metrics.id.startsWith("mobile") ? 150 : 177;
      const columns = Math.max(1, Math.min(cols, Math.floor((w + gap) / (minW + gap))));
      const cardWidth = Math.floor((w - (columns - 1) * gap) / columns);
      const next = resolveCatalogLayout(
        metrics.id.startsWith("mobile"),
        true,
        cardWidth * columns + (columns - 1) * gap,
        metrics,
      );
      const current = getActiveLayout();
      if (
        next.metrics.id === current.metrics.id &&
        next.cardWidth === current.cardWidth
      ) {
        return;
      }
      void this.warmLayoutBitmaps(host, next);
    };
    if (window.requestIdleCallback) window.requestIdleCallback(() => run());
    else window.setTimeout(run, 800);
  }

  private async warmLayoutBitmaps(host: HTMLElement, layout: CatalogLayout): Promise<void> {
    const prev = getActiveLayout();
    const prevModel = getLiveCellBoxModel();
    this.canvas?.pause();
    setActiveLayout(layout);
    const model = resolveLiveCellBoxModel(layout, activeDpr());
    setLiveCellBoxModel(model);
    applyTicketCssVars(host, layout.metrics);
    applyCellBoxCssVars(host, model, layout.metrics);
    try {
      await warmCatalogAtlasForPrewarm(layout);
    } finally {
      setActiveLayout(prev);
      if (prevModel) setLiveCellBoxModel(prevModel);
      this.syncCellBoxCssVarsOnHosts();
      this.canvas?.resume();
    }
  }

  /** Fingerprint for the DOM band — skip work when scrollend fires with the same band. */
  private bandFingerprint(dom: readonly TicketSlot[]): string {
    if (dom.length === 0) return "";
    const first = dom[0]!.id;
    const last = dom[dom.length - 1]!.id;
    return `${first}|${last}|${dom.length}|${Math.round(this.host.scroll.scrollTop)}`;
  }

  /**
   * Run only after scrolling stops. Never wired to the `scroll` event when
   * `scrollend` exists — trace showed `resyncBandAtRest` dominated main-thread time.
   */
  private resyncBandAtRest(): void {
    const { dom } = this.bandForScroll(this.host.scroll.scrollTop);
    const fp = this.bandFingerprint(dom);
    if (fp === this.lastBandFingerprint) return;
    this.lastBandFingerprint = fp;

    const ids = new Set(dom.map((s) => s.id));
    const canvas = this.canvas;

    // DOM first, then canvas holes after the compositor has painted the band.
    requestAnimationFrame(() => {
      const pendingHide = this.syncDom(dom);
      if (!canvas) {
        this.dom?.hideEvictedSlots(pendingHide);
        return;
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          canvas.setSkip(ids, { paint: true });
          this.dom?.hideEvictedSlots(pendingHide);
        });
      });
    });
  }

  /** Defer band work to idle so scrollend stays off the critical path. */
  private queueBandResync(): void {
    const gen = ++this.bandResyncGen;
    const run = () => {
      if (gen !== this.bandResyncGen) return;
      this.resyncBandAtRest();
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 300 });
    } else {
      setTimeout(run, 0);
    }
  }

  private scrollbarRefs(): CatalogScrollbarRefs {
    return {
      host: this.host.ticketCatalogHost,
      scroll: this.host.scroll,
      lane: this.host.scrollbarLane,
      thumb: this.host.scrollbarThumb,
    };
  }

  private syncScrollbarChrome(): void {
    syncCatalogScrollbar(this.scrollbarRefs());
  }

  private bindScrollbarChrome(): void {
    this.scrollbarDragCleanup = bindCatalogScrollbarDrag(this.scrollbarRefs(), () =>
      this.syncScrollbarChrome(),
    );
    if (typeof ResizeObserver === "undefined") return;
    this.scrollbarRo = new ResizeObserver(() => this.syncScrollbarChrome());
    this.scrollbarRo.observe(this.host.scroll);
    this.scrollbarRo.observe(this.host.content);
    this.syncScrollbarChrome();
  }

  private bindScroll(): void {
    const container = this.host.scroll;
    let settleTimer = 0 as number;

    // Top-fade via IntersectionObserver — no scrollTop read on every scroll event.
    const topSentinel = document.createElement("div");
    topSentinel.style.cssText =
      "position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none";
    container.appendChild(topSentinel);
    // Set initial state synchronously before the first IO callback fires.
    container.classList.toggle(
      "ticketCatalog_isOverflowingStart",
      container.scrollTop > SCROLL_TOP_EPSILON_PX,
    );
    const io = new IntersectionObserver(
      ([entry]) => {
        container.classList.toggle(
          "ticketCatalog_isOverflowingStart",
          !(entry?.isIntersecting ?? true),
        );
      },
      { root: container, threshold: 0 },
    );
    io.observe(topSentinel);

    const onScrollEnd = () => {
      this.syncScrollbarChrome();
      this.queueBandResync();
    };

    // On scroll: zero work when scrollend is supported.
    // Only the settle-timer fallback fires for browsers without scrollend.
    const onScroll = () => {
      this.syncScrollbarChrome();
      if ("onscrollend" in globalThis) return;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(onScrollEnd, SCROLL_BAND_SETTLE_MS);
    };

    container.addEventListener("scroll", onScroll, { passive: true });

    if ("onscrollend" in globalThis) {
      container.addEventListener("scrollend", onScrollEnd, { passive: true });
    }

    this.scrollCleanup = () => {
      container.removeEventListener("scroll", onScroll);
      if ("onscrollend" in globalThis) {
        container.removeEventListener("scrollend", onScrollEnd);
      }
      if (settleTimer) clearTimeout(settleTimer);
      io.disconnect();
      topSentinel.remove();
    };
  }

  private smoothScrollToTop(): void {
    const c = this.host.scroll;
    if (c.scrollTop <= SCROLL_TOP_EPSILON_PX) return;
    if (prefersReducedMotion()) {
      c.scrollTop = 0;
      return;
    }
    c.scrollTo({ top: c.scrollTop, behavior: "auto" });
    c.scrollTo({ top: 0, behavior: "smooth" });
  }

  private bindViewport(): void {
    const onResize = () => {
      this.hideCanvas();
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    const mq = window.matchMedia("(orientation: portrait)");
    mq.addEventListener?.("change", onResize);

    this.resizeCleanup = () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      mq.removeEventListener?.("change", onResize);
    };
  }

  private bindResizeObserver(): void {
    if (typeof ResizeObserver === "undefined") return;
    this.ro = new ResizeObserver(() => {
      this.onCatalogFrameResize();
    });
    this.ro.observe(this.host.catalogFrame);
  }

  private onTicketsChanged(added: string[]): void {
    if (this.tickets.length === 0) {
      this.prevSlots = new Map();
      this.canvas?.clear();
      this.syncDom();
      this.updateStats();
      return;
    }

    for (const id of added) this.knownIds.add(id);
    const animate =
      added.length > 0 && added.length < APPEAR_MAX_TICKETS && !prefersReducedMotion();
    this.freshIds = new Set(animate ? added.slice(-TICKET_ANIMATED_COUNT) : []);
    const from = this.prevSlots;
    this.syncDom();
    const bulkScroll = added.length >= APPEAR_MAX_TICKETS;
    this.prevSlots = new Map(this.slots.map((slot) => [slot.id, { x: slot.x, y: slot.y }]));

    let scheduleSmoothScroll: (() => void) | undefined;
    if (added.length > 0) {
      if (this.scrollTimer) window.clearTimeout(this.scrollTimer);
      if (this.bulkScrollResyncTimer) window.clearTimeout(this.bulkScrollResyncTimer);

      const delay = animate ? APPEAR_MS : 0;
      const runSmoothScrollToBottom = () => {
        this.scrollTimer = 0;
        const maxScroll = Math.max(
          0,
          this.host.scroll.scrollHeight - this.host.scroll.clientHeight,
        );
        this.host.scroll.scrollTo({ top: maxScroll, behavior: "smooth" });
        if (bulkScroll) {
          this.bulkScrollResyncTimer = window.setTimeout(() => {
            this.bulkScrollResyncTimer = 0;
            this.lastBandFingerprint = "";
            this.queueBandResync();
          }, 900);
        }
      };

      scheduleSmoothScroll = () => {
        this.scrollTimer = window.setTimeout(runSmoothScrollToBottom, delay);
      };
    }

    requestAnimationFrame(() => {
      this.dom?.playMoves(from, this.slots, this.shuffleMs);
      if (added.length === 0) return;
      if (this.canvasReady && this.canvas) {
        this.syncCanvas();
        if (bulkScroll) {
          void this.canvas.waitForPaint().then(scheduleSmoothScroll);
        } else {
          scheduleSmoothScroll?.();
        }
      }
    });
  }

  private addCount(count: number): void {
    this.shuffleMs = 400;
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

  private reset(): void {
    const hadTickets = this.tickets.length > 0;
    const fadeEls = hadTickets ? this.dom?.boundCardElements() ?? [] : [];
    const finishReset = () => {
      this.tickets = [];
      this.knownIds = new Set();
      this.freshIds = new Set();
      if (this.shuffleTimer) window.clearTimeout(this.shuffleTimer);
      this.drawnBalls = [];
      this.drawRound = 0;
      this.lastDraw = "";
      this.dom?.clearMotion();
      this.canvas?.clear();
      this.applyLayout({ syncDomBand: true, syncCanvasCatalog: false });
      this.smoothScrollToTop();
      this.updateStats();
    };
    if (fadeEls.length > 0) {
      animateRemovedTickets(fadeEls, finishReset);
      return;
    }
    finishReset();
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
    if (nextRound >= DRAW_ROUND_COUNT) finishRound(this.tickets);
    this.drawRound = nextRound;
    this.lastDraw =
      spec.multiplier > 0
        ? `${ball} · ${spec.multiplier}× · ${hits.length} tickets`
        : `${ball} · dab · ${hits.length} tickets`;

    this.syncDom();
    const changedIds =
      nextRound >= DRAW_ROUND_COUNT
        ? new Set(this.tickets.map((t) => t.id))
        : new Set(hits.map((h) => h.id));
    requestAnimationFrame(() => {
      this.dom?.playDraws(hits);
      this.canvas?.refreshForTicketIds(changedIds);
    });
    if (this.shuffleTimer) window.clearTimeout(this.shuffleTimer);
    const delay = Math.max(shuffleDelayMs(hits, this.tickets), takeGestureDelay());
    this.shuffleTimer = window.setTimeout(() => {
      this.shuffleTimer = 0;
      this.shuffleMs = 600;
      const sorted = sortTickets(this.tickets);
      const same = sorted.every((ticket, index) => ticket === this.tickets[index]);
      if (!same) {
        this.tickets = sorted;
        this.applyLayout({ syncDomBand: true, syncCanvasCatalog: true });
        this.onTicketsChanged([]);
      }
    }, delay);
    this.updateStats();
  }

  private clearDraws(): void {
    if (this.shuffleTimer) window.clearTimeout(this.shuffleTimer);
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
    this.shuffleMs = 400;
    this.tickets = [...this.tickets].sort((a, b) => Number(a.no) - Number(b.no));
    this.applyLayout({ syncDomBand: true, syncCanvasCatalog: true });
    this.refreshStates();
    this.updateStats();
  }

  private updateStats(): void {
    const { ui } = this.host;
    const layout = getActiveLayout();
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
    const tiles = this.canvas?.tileCount ?? 0;
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

    const drawLabel =
      this.drawRound >= DRAW_ROUND_COUNT
        ? "6/6 drawn"
        : `Draw ${this.drawRound + 1}/6${
            DRAW_ROUNDS[this.drawRound]!.multiplier > 0
              ? ` · ${DRAW_ROUNDS[this.drawRound]!.multiplier}×`
              : ""
          }`;
    ui.drawBtn.textContent = drawLabel;
    ui.drawBtn.disabled =
      this.tickets.length === 0 || this.drawRound >= DRAW_ROUND_COUNT;

    for (const btn of ui.ticketAdds.querySelectorAll<HTMLButtonElement>("[data-add-count]")) {
      btn.disabled = this.tickets.length >= MAX_TICKETS;
    }
  }
}
