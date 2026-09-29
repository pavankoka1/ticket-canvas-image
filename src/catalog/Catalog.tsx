import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
} from "./catalogLayout";
import { resolveLiveCellBoxModel } from "./cellAtlas";
import { ensureTicketFontsForLayout } from "./ticketFont";
import { warmCellBitmaps } from "./cellBitmaps";
import { warmIdDigits } from "./headerGlyphs";
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
  TICKET_PRESETS,
  type TicketPresetId,
} from "./ticketPresets";

type PresetMode = "auto" | TicketPresetId;

/** Rebuild the canvas only after the viewport has been still this long. */
const SETTLE_MS = 1500;

function layoutCacheKey(layout: ReturnType<typeof getActiveLayout>): string {
  return `${layout.metrics.id}|${layout.cardWidth}|${layout.columns}|${layout.cardHeight}`;
}

export function Catalog() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const domHostRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const atlasHostRef = useRef<HTMLDivElement>(null);
  const badgeHostRef = useRef<HTMLDivElement>(null);
  const idHostRef = useRef<HTMLDivElement>(null);
  const prewarmHostRef = useRef<HTMLDivElement>(null);
  const cssHostRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef(0);
  const domPoolRef = useRef<DomPool | null>(null);
  const canvasPoolRef = useRef<CanvasPool | null>(null);
  const slotsRef = useRef<TicketSlot[]>([]);
  const ticketsByIdRef = useRef<Map<string, Ticket>>(new Map());
  const atlasGenRef = useRef(0);
  const prevLayoutKeyRef = useRef("");
  /** Scrollport clientHeight — measured at mount / resize, never on scroll. */
  const clientHeightRef = useRef(0);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [canvasReady, setCanvasReady] = useState(false);
  const [domCount, setDomCount] = useState(0);
  const [tileCount, setTileCount] = useState(0);
  const [presetMode, setPresetMode] = useState<PresetMode>("auto");
  const [drawRound, setDrawRound] = useState(0);
  const [lastDraw, setLastDraw] = useState("");
  const drawnBallsRef = useRef<number[]>([]);
  const prevSlotsRef = useRef(new Map<string, { x: number; y: number }>());
  const shuffleMsRef = useRef(400);
  const shuffleTimerRef = useRef(0);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1366,
    h: typeof window !== "undefined" ? window.innerHeight : 768,
  }));

  const metrics =
    presetMode === "auto"
      ? resolvePresetFromViewport(viewport.w, viewport.h)
      : getPreset(presetMode);
  const isMobile = metrics.id.startsWith("mobile");
  const poolSize = domPoolSize(isMobile);
  const isLandscape = viewport.w > viewport.h;
  const frame = useMemo(
    () => resolveTicketFrame(viewport.w, viewport.h),
    [viewport],
  );
  const layout = useMemo(
    () => resolveCatalogLayout(isMobile, isLandscape, frame.width, metrics),
    [isMobile, isLandscape, frame.width, metrics],
  );

  useLayoutEffect(() => {
    setActiveLayout(layout);
    // Prefer measured atlas geometry when available for this card size so a
    // layout-effect re-run never clobbers measured bodyTop with analytic.
    const model = resolveLiveCellBoxModel(layout);
    setLiveCellBoxModel(model);
    const host = cssHostRef.current;
    if (host) {
      applyTicketCssVars(host, layout.metrics);
      applyCellBoxCssVars(host, model, layout.metrics);
    }
    if (atlasHostRef.current) {
      applyTicketCssVars(atlasHostRef.current, layout.metrics);
      applyCellBoxCssVars(atlasHostRef.current, model, layout.metrics);
    }
  }, [layout]);

  const slots = useMemo(
    () =>
      buildSlots(
        tickets,
        layout.columns,
        layout.cardWidth,
        layout.cardHeight,
        layout.gap,
        layout.gap,
      ),
    [tickets, layout],
  );
  const ticketsById = useMemo(
    () => new Map(tickets.map((t) => [t.id, t])),
    [tickets],
  );
  const height = contentHeight(tickets.length, layout);
  const width = contentWidth(layout);
  const spacerPx =
    tickets.length > 0
      ? catalogSpacerRows(viewport.w, viewport.h) * (layout.cardHeight + layout.gap)
      : 0;

  slotsRef.current = slots;
  ticketsByIdRef.current = ticketsById;

  const freshIdsRef = useRef(new Set<string>());
  const knownIdsRef = useRef(new Set<string>());
  const scrollTimerRef = useRef(0);

  /** Refresh clientHeight + canvas host origin (mount / resize / settle only). */
  const measureScrollGeometry = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    clientHeightRef.current = container.clientHeight;
  }, []);

  const bandForScroll = useCallback((scrollTop: number) => {
    return computeDomBand(
      slotsRef.current,
      scrollTop,
      clientHeightRef.current,
      ROW_BUFFER,
      poolSize,
    );
  }, [poolSize]);

  const syncDom = useCallback((domSlots?: readonly TicketSlot[]) => {
    const container = scrollRef.current;
    const dom = domPoolRef.current;
    if (!container || !dom?.isReady) return;

    const slots =
      domSlots ??
      bandForScroll(container.scrollTop).dom;
    const fresh = freshIdsRef.current;
    freshIdsRef.current = new Set();
    dom.rebind(slots, ticketsByIdRef.current, fresh);
    for (const id of fresh) knownIdsRef.current.add(id);
    setDomCount(slots.length);
  }, [bandForScroll]);

  /** Paint every ticket that is not on a live DOM card. */
  const syncCanvas = useCallback(() => {
    const canvas = canvasPoolRef.current;
    const container = scrollRef.current;
    if (!canvas?.isReady) return;
    const ids = new Set(bandForScroll(container?.scrollTop ?? 0).dom.map((s) => s.id));
    canvas.setCatalog(slotsRef.current, ticketsByIdRef.current, ids);
    setTileCount(canvas.tileCount);
  }, [bandForScroll]);

  const revealCanvas = useCallback(() => {
    const host = canvasHostRef.current;
    if (host) host.style.visibility = "visible";
  }, []);

  const hideCanvas = useCallback(() => {
    const host = canvasHostRef.current;
    if (host) host.style.visibility = "hidden";
  }, []);

  /** Push the current live cell box model onto hosts that size pooled DOM cards. */
  const syncCellBoxCssVarsOnHosts = useCallback(() => {
    const model = getLiveCellBoxModel();
    if (!model) return;
    const metrics = getActiveLayout().metrics;
    const app = cssHostRef.current;
    if (app) applyCellBoxCssVars(app, model, metrics);
    const atlas = atlasHostRef.current;
    if (atlas) applyCellBoxCssVars(atlas, model, metrics);
  }, []);

  const warmLayoutBitmaps = useCallback(async (
    host: HTMLElement,
    layout: ReturnType<typeof getActiveLayout>,
  ) => {
    const prev = getActiveLayout();
    const prevModel = getLiveCellBoxModel();
    canvasPoolRef.current?.pause();
    setActiveLayout(layout);
    const model = resolveLiveCellBoxModel(layout, activeDpr());
    setLiveCellBoxModel(model);
    applyTicketCssVars(host, layout.metrics);
    applyCellBoxCssVars(host, model, layout.metrics);
    try {
      await ensureTicketFontsForLayout(layout.metrics);
      await warmCellBitmaps(host);
      await warmIdDigits(host);
    } finally {
      setActiveLayout(prev);
      if (prevModel) setLiveCellBoxModel(prevModel);
      syncCellBoxCssVarsOnHosts();
      canvasPoolRef.current?.resume();
    }
  }, [syncCellBoxCssVarsOnHosts]);

  const scheduleLandscapePrewarm = useCallback(() => {
    const host = prewarmHostRef.current;
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
      void warmLayoutBitmaps(host, next);
    };
    if (window.requestIdleCallback) window.requestIdleCallback(() => run());
    else window.setTimeout(run, 800);
  }, [warmLayoutBitmaps]);

  const startCanvasWarm = useCallback(() => {
    const layoutNow = getActiveLayout();
    const gen = ++atlasGenRef.current;
    void (async () => {
      const host = atlasHostRef.current;
      await ensureTicketFontsForLayout(layoutNow.metrics);
      if (gen !== atlasGenRef.current) return;
      if (host) {
        await warmCellBitmaps(host);
        if (gen !== atlasGenRef.current) return;
        await warmIdDigits(host);
      }
      if (gen !== atlasGenRef.current) return;
      setCanvasReady(true);
      syncCellBoxCssVarsOnHosts();
      syncCanvas();
      syncDom();
      revealCanvas();
      scheduleLandscapePrewarm();
    })();
  }, [
    syncCanvas,
    syncDom,
    revealCanvas,
    scheduleLandscapePrewarm,
    syncCellBoxCssVarsOnHosts,
  ]);

  /**
   * Resize / orientation teardown. The canvas underlay is built for one exact
   * size; when the viewport changes we DROP it immediately (hide + clear +
   * cancel any in-flight warm — but keep the RAM/IDB cache) so a stale-size
   * canvas never sits behind the DOM that has already reflowed. The DOM reflows
   * on its own and covers the viewport, so a hidden canvas is invisible to the
   * user. We rebuild only after the viewport has been still for SETTLE_MS.
   */
  const tearDownAndScheduleRebuild = useCallback(() => {
    hideCanvas();
    canvasPoolRef.current?.clear();
    setTileCount(0);
    atlasGenRef.current += 1;
    setCanvasReady(false);
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = 0;
      measureScrollGeometry();
      startCanvasWarm();
    }, SETTLE_MS);
  }, [hideCanvas, startCanvasWarm, measureScrollGeometry]);

  useEffect(() => {
    const domHost = domHostRef.current;
    const canvasHost = canvasHostRef.current;
    if (!domHost || !canvasHost) return;
    const dom = new DomPool(domHost, poolSize);
    const canvas = new CanvasPool(canvasHost);
    dom.mount();
    canvas.mount();
    domPoolRef.current = dom;
    canvasPoolRef.current = canvas;
    measureScrollGeometry();
    syncCanvas();
    syncDom();
    return () => {
      canvas.clear();
      domHost.replaceChildren();
      domPoolRef.current = null;
      canvasPoolRef.current = null;
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    };
  }, [syncCanvas, syncDom, poolSize, measureScrollGeometry]);

  useEffect(() => {
    const onShift = () => {
      hideCanvas();
      canvasPoolRef.current?.clear();
      setTileCount(0);
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener("resize", onShift);
    window.addEventListener("orientationchange", onShift);
    const mq = window.matchMedia("(orientation: portrait)");
    mq.addEventListener?.("change", onShift);
    return () => {
      window.removeEventListener("resize", onShift);
      window.removeEventListener("orientationchange", onShift);
      mq.removeEventListener?.("change", onShift);
    };
  }, [hideCanvas]);

  useEffect(() => {
    const key = layoutCacheKey(layout);
    if (key === prevLayoutKeyRef.current) {
      domPoolRef.current?.refreshLayout();
      measureScrollGeometry();
      syncCanvas();
      syncDom();
      return;
    }
    const firstBuild = prevLayoutKeyRef.current === "";
    prevLayoutKeyRef.current = key;
    // DOM reflows immediately (it covers the viewport); canvas waits for settle.
    domPoolRef.current?.refreshLayout();
    measureScrollGeometry();
    syncDom();

    if (firstBuild) {
      // Initial size — no stale canvas to tear down; warm right away.
      const t = window.setTimeout(() => {
        measureScrollGeometry();
        startCanvasWarm();
        syncCanvas();
        syncDom();
      }, 120);
      return () => window.clearTimeout(t);
    }
    // A real size change (resize / orientation / preset) — drop the old canvas
    // now and rebuild SETTLE_MS after the viewport goes still.
    tearDownAndScheduleRebuild();
  }, [layout, startCanvasWarm, syncCanvas, syncDom, tearDownAndScheduleRebuild, measureScrollGeometry]);

  useLayoutEffect(() => {
    if (tickets.length === 0) {
      prevSlotsRef.current = new Map();
      canvasPoolRef.current?.clear();
      setTileCount(0);
      syncDom();
      return;
    }
    const added: string[] = [];
    for (const ticket of tickets) {
      if (!knownIdsRef.current.has(ticket.id)) added.push(ticket.id);
    }
    for (const id of added) knownIdsRef.current.add(id);
    // Fortunamania appearAddedTickets: under 25 animate the last 12, then
    // smooth-scroll once that gesture ends. 25+ skip the gesture and scroll now.
    const animate =
      added.length > 0 && added.length < APPEAR_MAX_TICKETS && !prefersReducedMotion();
    freshIdsRef.current = new Set(animate ? added.slice(-TICKET_ANIMATED_COUNT) : []);
    const from = prevSlotsRef.current;
    syncDom();
    syncCanvas();
    domPoolRef.current?.playMoves(from, slotsRef.current, shuffleMsRef.current);
    prevSlotsRef.current = new Map(slotsRef.current.map((slot) => [slot.id, { x: slot.x, y: slot.y }]));
    const scroll = scrollRef.current;
    if (added.length === 0 || !scroll) return;
    if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    const delay = animate ? APPEAR_MS : 0;
    scrollTimerRef.current = window.setTimeout(() => {
      scrollTimerRef.current = 0;
      const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
      scroll.scrollTo({ top: maxScroll, behavior: "smooth" });
    }, delay);
  }, [tickets, height, syncCanvas, syncDom]);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    };
  }, []);

  // Freeze DOM band + canvas skip during scroll. Native overflow carries the
  // content (and existing canvas holes) for free. Resync once after settle —
  // scrollend when available, else a short debounce (not SETTLE_MS).
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let settleTimer = 0;

    const resyncBand = () => {
      settleTimer = 0;
      const { dom } = bandForScroll(container.scrollTop);
      const ids = new Set(dom.map((s) => s.id));
      syncDom(dom);
      canvasPoolRef.current?.setSkip(ids);
    };

    const supportsScrollEnd = "onscrollend" in window;
    if (supportsScrollEnd) {
      container.addEventListener("scrollend", resyncBand, { passive: true });
      return () => {
        container.removeEventListener("scrollend", resyncBand);
      };
    }

    const onScroll = () => {
      if (settleTimer) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(resyncBand, SCROLL_BAND_SETTLE_MS);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (settleTimer) window.clearTimeout(settleTimer);
    };
  }, [syncDom, bandForScroll]);

  // clientHeight / host origin only change on resize (incl. mobile keyboard).
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      measureScrollGeometry();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [measureScrollGeometry]);

  const addCount = (count: number) => {
    shuffleMsRef.current = 400;
    setTickets((prev) => {
      const room = MAX_TICKETS - prev.length;
      if (room <= 0) return prev;
      return [...prev, ...createTickets(Math.min(count, room))];
    });
  };

  const reset = () => {
    setTickets([]);
    knownIdsRef.current = new Set();
    freshIdsRef.current = new Set();
    if (shuffleTimerRef.current) window.clearTimeout(shuffleTimerRef.current);
    drawnBallsRef.current = [];
    setDrawRound(0);
    setLastDraw("");
    domPoolRef.current?.clearMotion();
    setDomCount(0);
    setTileCount(0);
    canvasPoolRef.current?.clear();
    syncDom();
  };

  const rebuildCanvas = () => {
    prevLayoutKeyRef.current = "";
    setCanvasReady(false);
    startCanvasWarm();
  };

  useEffect(() => {
    if (!canvasReady || tickets.length === 0) return;
    canvasPoolRef.current?.refresh();
    syncCanvas();
  }, [tickets, layout, syncCanvas, canvasReady]);

  const refreshStates = useCallback(() => {
    canvasPoolRef.current?.refresh();
    syncDom();
  }, [syncDom]);

  const drawBall = () => {
    if (tickets.length === 0 || drawRound >= DRAW_ROUND_COUNT) return;
    const spec = DRAW_ROUNDS[drawRound]!;
    const ball = pickDrawBall(
      tickets,
      drawnBallsRef.current,
      new Set(bandForScroll(scrollRef.current?.scrollTop ?? 0).dom.map((s) => s.id)),
    );
    if (ball == null) return;
    drawnBallsRef.current.push(ball);
    const nextRound = drawRound + 1;
    const hits = applyDrawnBall(tickets, ball, spec.multiplier);
    if (nextRound >= DRAW_ROUND_COUNT) finishRound(tickets);
    setDrawRound(nextRound);
    setLastDraw(
      spec.multiplier > 0
        ? `${ball} · ${spec.multiplier}× · ${hits.length} tickets`
        : `${ball} · dab · ${hits.length} tickets`,
    );
    refreshStates();
    domPoolRef.current?.playDraws(hits);
    canvasPoolRef.current?.refresh();
    syncCanvas();
    if (shuffleTimerRef.current) window.clearTimeout(shuffleTimerRef.current);
    const delay = shuffleDelayMs(hits, tickets);
    shuffleTimerRef.current = window.setTimeout(() => {
      shuffleTimerRef.current = 0;
      shuffleMsRef.current = 600;
      setTickets((current) => {
        const sorted = sortTickets(current);
        const same = sorted.every((ticket, index) => ticket === current[index]);
        return same ? current : sorted;
      });
    }, delay);
  };

  const clearDraws = () => {
    if (shuffleTimerRef.current) window.clearTimeout(shuffleTimerRef.current);
    for (const ticket of tickets) {
      ticket.hits = [];
      ticket.multipliers = {};
      ticket.win = "";
      ticket.disabled = false;
    }
    drawnBallsRef.current = [];
    setDrawRound(0);
    setLastDraw("");
    domPoolRef.current?.clearMotion();
    shuffleMsRef.current = 400;
    setTickets((current) =>
      [...current].sort((a, b) => Number(a.no) - Number(b.no)),
    );
    refreshStates();
  };

  return (
    <div className="app" ref={cssHostRef}>
      <header className="toolbar">
        <h1>Sprite canvas POC</h1>
        <p className="toolbar__hint">
          +1 and +5 play the catalog appear gesture, then scroll to the bottom.
          +25 and +100 only scroll. Live rows stay DOM. Scrolled-away rows use
          layered sprite paint (<code>paintCatalogTicket</code>). Up to{" "}
          {MAX_TICKETS} tickets.
          {" · "}
          <a href="/compare">DOM↔Canvas compare</a>
        </p>
        <div className="toolbar__row">
          <div className="ticketAdds">
            {([1, 5, 25, 100] as const).map((count) => (
              <button
                key={count}
                type="button"
                className="ticketAdds__btn"
                onClick={() => addCount(count)}
                disabled={tickets.length >= MAX_TICKETS}
              >
                +{count}
              </button>
            ))}
          </div>
          <button type="button" className="btn-ghost" onClick={reset}>
            Reset
          </button>
          <button type="button" className="btn-ghost" onClick={rebuildCanvas}>
            Rebuild canvas
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={drawBall}
            disabled={tickets.length === 0 || drawRound >= DRAW_ROUND_COUNT}
          >
            {drawRound >= DRAW_ROUND_COUNT
              ? "6/6 drawn"
              : `Draw ${drawRound + 1}/6${
                  DRAW_ROUNDS[drawRound]!.multiplier > 0
                    ? ` · ${DRAW_ROUNDS[drawRound]!.multiplier}×`
                    : ""
                }`}
          </button>
          <button type="button" className="btn-ghost" onClick={clearDraws}>
            Clear draws
          </button>
          {lastDraw ? <span className="stat">last ball {lastDraw}</span> : null}
          <label className="stat toolbar__sheet">
            size{" "}
            <select
              value={presetMode}
              onChange={(e) => setPresetMode(e.target.value as PresetMode)}
            >
              <option value="auto">Auto (viewport)</option>
              {TICKET_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <span className="stat">
            layout{" "}
            <strong>
              {layout.metrics.id} · {layout.columns}col · {layout.cardWidth}×
              {layout.cardHeight}
            </strong>
          </span>
          <span className="stat">
            tickets <strong>{tickets.length}</strong>/{MAX_TICKETS}
          </span>
          <span className="stat">
            tiles <strong>{tileCount}</strong>
          </span>
          <span className="stat">
            canvas{" "}
            <strong>{canvasReady ? "ready" : "…"}</strong>
          </span>
          <span className="stat">
            dom <strong>{domCount}</strong>/{poolSize}
          </span>
        </div>
      </header>

      <div
        className="catalogFrame"
        style={{ width: frame.width, height: frame.height }}
      >
        <div ref={scrollRef} className="catalog">
          <div
            ref={contentRef}
            className="catalog__content"
            style={{
              width: `${width}px`,
              height: `${height + spacerPx}px`,
              minHeight: height > 0 ? undefined : 80,
            }}
          >
            <div ref={canvasHostRef} className="catalog__canvas" aria-hidden />
            <div ref={domHostRef} className="catalog__dom" />
          </div>
        </div>
      </div>
      <div ref={atlasHostRef} className="catalog__captureHost" />
      <div ref={badgeHostRef} className="catalog__captureHost" />
      <div ref={idHostRef} className="catalog__captureHost" />
      <div ref={prewarmHostRef} className="catalog__captureHost" />
    </div>
  );
}
