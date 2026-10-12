import {
  APPEAR_MAX_TICKETS,
  APPEAR_MS,
  prefersReducedMotion,
  TICKET_ANIMATED_COUNT,
} from "./appear";
import { computeDomBand } from "./bands";
import { CanvasPool } from "./CanvasPool";
import {
  activeDpr,
  applyCellBoxCssVars,
  getLiveCellBoxModel,
  setLiveCellBoxModel,
} from "./cellBoxModel";
import {
  catalogSpacerRows,
  contentHeight,
  contentWidth,
  getActiveLayout,
  resolveCatalogLayout,
  resolveTicketFrame,
  setActiveLayout,
  type CatalogLayout,
} from "./catalogLayout";
import { resolveLiveCellBoxModel } from "./cellAtlas";
import { ensureTicketFontsForLayout } from "./ticketFont";
import {
  CATALOG_FIGMA_DESKTOP_LOCK,
  FIGMA_DESKTOP_CATALOG_FRAME_WIDTH,
  figmaDesktopCatalogMetrics,
} from "./catalogFigmaDesktop";
import { ensureCatalogSvgAtlasWarm } from "./catalogSvgPaint";
import { setCompareRenderMode } from "../catalog/compareRenderMode";
import { DomPool } from "./DomPool";
import { MAX_TICKETS, ROW_BUFFER, SCROLL_BAND_SETTLE_MS, domPoolSize } from "./layout";
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
} from "./tickets";
import {
  applyTicketCssVars,
  getPreset,
  resolvePresetFromViewport,
} from "./ticketPresets";
import type { ToolbarRefs } from "./buildToolbar";
import { readPresetMode, type PresetMode } from "./buildToolbar";

const RESIZE_CANVAS_SETTLE_MS = 300;

function layoutCacheKey(layout: CatalogLayout): string {
  return `${layout.metrics.id}|${layout.cardWidth}|${layout.columns}|${layout.cardHeight}`;
}

export type TicketCatalogControllerHost = {
  root: HTMLElement;
  ui: ToolbarRefs;
  catalogFrame: HTMLElement;
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

  private viewport = { w: window.innerWidth, h: window.innerHeight };
  private presetMode: PresetMode = CATALOG_FIGMA_DESKTOP_LOCK ? "desktopMedium" : "auto";
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

  constructor(host: TicketCatalogControllerHost) {
    this.host = host;
  }

  start(): void {
    if (CATALOG_FIGMA_DESKTOP_LOCK) setCompareRenderMode("svg-all");

    this.wireToolbar();
    this.ensurePools();
    this.measureScrollGeometry();
    this.applyLayout({ syncDomBand: true, syncCanvasCatalog: true });
    this.bindScroll();
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
    ui.presetSelect.addEventListener("change", () => {
      this.presetMode = readPresetMode(ui.presetSelect);
      this.applyLayout({ syncDomBand: true, syncCanvasCatalog: false });
      this.scheduleCanvasAfterResize();
    });

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
    const metrics = this.resolveMetrics();
    const isMobile = CATALOG_FIGMA_DESKTOP_LOCK ? false : metrics.id.startsWith("mobile");
    return domPoolSize(isMobile);
  }

  private resolveMetrics() {
    if (CATALOG_FIGMA_DESKTOP_LOCK) return figmaDesktopCatalogMetrics();
    return this.presetMode === "auto"
      ? resolvePresetFromViewport(this.viewport.w, this.viewport.h)
      : getPreset(this.presetMode);
  }

  private resolveFrame() {
    if (CATALOG_FIGMA_DESKTOP_LOCK) {
      return { width: FIGMA_DESKTOP_CATALOG_FRAME_WIDTH, height: 231 };
    }
    return resolveTicketFrame(this.viewport.w, this.viewport.h);
  }

  private resolveLayout(): CatalogLayout {
    const metrics = this.resolveMetrics();
    const isMobile = CATALOG_FIGMA_DESKTOP_LOCK ? false : metrics.id.startsWith("mobile");
    const isLandscape = this.viewport.w > this.viewport.h;
    const frame = this.resolveFrame();
    return resolveCatalogLayout(
      isMobile,
      CATALOG_FIGMA_DESKTOP_LOCK ? false : isLandscape,
      frame.width,
      metrics,
    );
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

  private syncDom(domSlots?: readonly TicketSlot[]): void {
    const dom = this.dom;
    if (!dom?.isReady) return;
    const slots =
      domSlots ?? this.bandForScroll(this.host.scroll.scrollTop).dom;
    const fresh = this.freshIds;
    this.freshIds = new Set();
    dom.rebind(slots, this.ticketsById, fresh);
    for (const id of fresh) this.knownIds.add(id);
    this.domCount = slots.length;
    this.updateStats();
  }

  private syncCanvas(): void {
    const canvas = this.canvas;
    if (!canvas?.isReady) return;
    const ids = new Set(
      this.bandForScroll(this.host.scroll.scrollTop).dom.map((s) => s.id),
    );
    canvas.setCatalog(this.slots, this.ticketsById, ids);
    this.updateStats();
  }

  private revealCanvas(): void {
    this.host.canvasHost.style.visibility = "visible";
  }

  private hideCanvas(): void {
    this.host.canvasHost.style.visibility = "hidden";
  }

  private syncCellBoxCssVarsOnHosts(): void {
    const model = getLiveCellBoxModel();
    if (!model) return;
    const metrics = getActiveLayout().metrics;
    applyCellBoxCssVars(this.host.root, model, metrics);
    applyCellBoxCssVars(this.host.atlasHost, model, metrics);
  }

  private applyLayout(opts: { syncDomBand: boolean; syncCanvasCatalog: boolean }): void {
    const layout = this.resolveLayout();
    const frame = this.resolveFrame();
    const key = layoutCacheKey(layout);

    setActiveLayout(layout);
    const model = resolveLiveCellBoxModel(layout);
    setLiveCellBoxModel(model);
    applyTicketCssVars(this.host.root, layout.metrics);
    applyCellBoxCssVars(this.host.root, model, layout.metrics);
    applyTicketCssVars(this.host.atlasHost, layout.metrics);
    applyCellBoxCssVars(this.host.atlasHost, model, layout.metrics);

    this.host.catalogFrame.style.width = `${frame.width}px`;
    this.host.catalogFrame.style.height = `${frame.height}px`;

    this.rebuildSlots();
    const height = contentHeight(this.tickets.length, layout);
    const width = contentWidth(layout);
    const spacerPx =
      this.tickets.length > 0
        ? catalogSpacerRows(this.viewport.w, this.viewport.h) *
          (layout.cardHeight + layout.gap)
        : 0;

    this.host.content.style.width = `${width}px`;
    this.host.content.style.height = `${height + spacerPx}px`;
    this.host.content.style.minHeight = height > 0 ? "" : "80px";

    this.dom?.refreshLayout();
    this.measureScrollGeometry();

    if (opts.syncDomBand) this.syncDom();
    if (opts.syncCanvasCatalog && this.canvasReady) this.syncCanvas();

    this.updateStats();

    const layoutChanged = key !== this.prevLayoutKey;
    this.prevLayoutKey = key;

    if (layoutChanged && this.prevPaintLayoutKey && this.canvasReady) {
      this.hideCanvas();
      this.canvas?.clear();
      this.canvasReady = false;
      this.atlasGen += 1;
      this.scheduleCanvasAfterResize(true);
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
    if (this.resizeCanvasTimer) window.clearTimeout(this.resizeCanvasTimer);
    this.resizeCanvasTimer = window.setTimeout(() => {
      this.resizeCanvasTimer = 0;
      this.flushCanvasAfterResize(forceRebuild);
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

    // Do not repaint on DPR-only changes (browser zoom) — let the compositor scale tiles.
  }

  private startCanvasWarm(): void {
    const layoutNow = getActiveLayout();
    const gen = ++this.atlasGen;
    void (async () => {
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
    })();
  }

  private scheduleLandscapePrewarm(): void {
    const host = this.host.prewarmHost;
    if (!host || window.innerWidth > window.innerHeight) return;
    const run = () => {
      const w = window.innerHeight;
      const h = window.innerWidth;
      const metrics = resolvePresetFromViewport(w, h);
      const next = resolveCatalogLayout(
        metrics.id.startsWith("mobile"),
        true,
        resolveTicketFrame(w, h).width,
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
      await ensureCatalogSvgAtlasWarm(layout);
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

    // DOM band + skip update on the next frame; canvas patches on idle so scrollend
    // does not run syncDom and full-tile svg-all paints in one task.
    requestAnimationFrame(() => {
      this.syncDom(dom);
      canvas?.setSkip(ids, { paint: false });
      if (!canvas) return;
      const paint = () => canvas.paintNow();
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(paint, { timeout: 800 });
      } else {
        setTimeout(paint, 16);
      }
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

  private bindScroll(): void {
    const container = this.host.scroll;
    let settleTimer = 0 as number;

    const onScrollEnd = () => this.queueBandResync();

    if ("onscrollend" in globalThis) {
      container.addEventListener("scrollend", onScrollEnd, { passive: true });
      this.scrollCleanup = () => {
        container.removeEventListener("scrollend", onScrollEnd);
      };
      return;
    }

    const onScroll = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(onScrollEnd, SCROLL_BAND_SETTLE_MS);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    this.scrollCleanup = () => {
      container.removeEventListener("scroll", onScroll);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }

  private bindViewport(): void {
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Browser zoom often changes DPR without changing layout CSS px — do not rebuild.
      if (w === this.viewport.w && h === this.viewport.h) return;
      this.viewport = { w, h };
      this.ensurePools();
      this.applyLayout({ syncDomBand: true, syncCanvasCatalog: false });
      this.scheduleCanvasAfterResize();
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
      this.measureScrollGeometry();
    });
    this.ro.observe(this.host.scroll);
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
      if (bulkScroll && this.canvasReady && this.canvas) {
        // No skip holes while scrolling: syncCanvas() would re-apply the stale DOM band.
        this.canvas.setCatalog(this.slots, this.ticketsById, new Set());
        void this.canvas.waitForPaint().then(scheduleSmoothScroll);
      } else {
        this.syncCanvas();
        scheduleSmoothScroll?.();
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
    const delay = shuffleDelayMs(hits, this.tickets);
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
