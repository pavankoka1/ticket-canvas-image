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
  resolveCellBoxModel,
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
import {
  cancelCellWarm,
  clearCellAtlas,
  getCellSpriteDataUrl,
  getTicketGeometry,
  resolveLiveCellBoxModel,
} from "./cellAtlas";
import { ticketChrome, warmCellBitmaps } from "./cellBitmaps";
import { idDigitCount, warmAmounts, warmIdDigits } from "./headerGlyphs";
import { DomPool } from "./DomPool";
import { DOM_POOL_SIZE, MAX_TICKETS, ROW_BUFFER } from "./layout";
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

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [atlasReady, setAtlasReady] = useState(0);
  const [idReady, setIdReady] = useState(0);
  const [domCount, setDomCount] = useState(0);
  const [tileCount, setTileCount] = useState(0);
  const [presetMode, setPresetMode] = useState<PresetMode>("auto");
  const [drawRound, setDrawRound] = useState(0);
  const [lastDraw, setLastDraw] = useState("");
  const drawnBallsRef = useRef<number[]>([]);
  const prevSlotsRef = useRef(new Map<string, { x: number; y: number }>());
  const shuffleMsRef = useRef(400);
  const shuffleTimerRef = useRef(0);
  const [spriteOverlay, setSpriteOverlay] = useState(false);
  const [overlayInfo, setOverlayInfo] = useState<string>("");
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1366,
    h: typeof window !== "undefined" ? window.innerHeight : 768,
  }));

  const metrics =
    presetMode === "auto"
      ? resolvePresetFromViewport(viewport.w, viewport.h)
      : getPreset(presetMode);
  const isMobile = metrics.id.startsWith("mobile");
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

  const domIds = useCallback((): Set<string> => {
    const container = scrollRef.current;
    if (!container) return new Set();
    const { dom: domSlots } = computeDomBand(
      slotsRef.current,
      container.scrollTop,
      container.clientHeight,
      ROW_BUFFER,
    );
    return new Set(domSlots.map((slot) => slot.id));
  }, []);

  const syncDom = useCallback(() => {
    const container = scrollRef.current;
    const dom = domPoolRef.current;
    if (!container || !dom?.isReady) return;

    const { dom: domSlots } = computeDomBand(
      slotsRef.current,
      container.scrollTop,
      container.clientHeight,
      ROW_BUFFER,
    );
    const fresh = freshIdsRef.current;
    freshIdsRef.current = new Set();
    dom.rebind(domSlots, ticketsByIdRef.current, fresh);
    for (const id of fresh) knownIdsRef.current.add(id);
    setDomCount(domSlots.length);
  }, []);

  /** Paint every ticket that is not on a live DOM card. */
  const syncCanvas = useCallback(() => {
    const canvas = canvasPoolRef.current;
    if (!canvas?.isReady) return;
    canvas.setCatalog(slotsRef.current, ticketsByIdRef.current, domIds());
    setTileCount(canvas.tileCount);
  }, [domIds]);

  const revealCanvas = useCallback(() => {
    const host = canvasHostRef.current;
    if (host) host.style.visibility = "visible";
  }, []);

  const hideCanvas = useCallback(() => {
    const host = canvasHostRef.current;
    if (host) host.style.visibility = "hidden";
  }, []);

  const warmLayoutBitmaps = useCallback(async (
    host: HTMLElement,
    layout: ReturnType<typeof getActiveLayout>,
  ) => {
    const prev = getActiveLayout();
    const prevModel = getLiveCellBoxModel();
    canvasPoolRef.current?.pause();
    setActiveLayout(layout);
    const model = resolveCellBoxModel(layout, activeDpr());
    setLiveCellBoxModel(model);
    applyTicketCssVars(host, layout.metrics);
    applyCellBoxCssVars(host, model, layout.metrics);
    try {
      await warmCellBitmaps(host);
      await ticketChrome(host, false);
      await ticketChrome(host, true);
      await ticketChrome(host, false, true);
      await warmIdDigits(host);
    } finally {
      setActiveLayout(prev);
      if (prevModel) setLiveCellBoxModel(prevModel);
      canvasPoolRef.current?.resume();
    }
  }, []);

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

  const startAtlasWarm = useCallback(() => {
    const host = atlasHostRef.current;
    if (!host) return;
    const layoutNow = getActiveLayout();
    applyTicketCssVars(host, layoutNow.metrics);
    const model =
      getLiveCellBoxModel() ?? resolveCellBoxModel(layoutNow, activeDpr());
    applyCellBoxCssVars(host, model, layoutNow.metrics);
    const gen = ++atlasGenRef.current;
    void (async () => {
      await warmCellBitmaps(host);
      if (gen !== atlasGenRef.current) return;
      setAtlasReady(65);
      await ticketChrome(host, false);
      await ticketChrome(host, true);
      await ticketChrome(host, false, true);
      if (gen !== atlasGenRef.current) return;
      await warmIdDigits(host);
      if (gen !== atlasGenRef.current) return;
      setIdReady(idDigitCount());
      const amounts = [
        ...new Set(
          [...ticketsByIdRef.current.values()].map((t) => t.win).filter(Boolean),
        ),
      ];
      await warmAmounts(host, amounts);
      if (gen !== atlasGenRef.current) return;
      canvasPoolRef.current?.refresh();
      syncCanvas();
      syncDom();
      revealCanvas();
      scheduleLandscapePrewarm();
    })();
  }, [syncCanvas, syncDom, revealCanvas, scheduleLandscapePrewarm]);

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
    setIdReady(0);
    atlasGenRef.current += 1; // invalidate the warm-progress generation
    cancelCellWarm(); // abandon the half-built old-size atlas (cache kept)
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = 0;
      startAtlasWarm(); // warms cell + id, then syncCanvas + revealCanvas
    }, SETTLE_MS);
  }, [hideCanvas, startAtlasWarm]);

  useEffect(() => {
    const domHost = domHostRef.current;
    const canvasHost = canvasHostRef.current;
    if (!domHost || !canvasHost) return;
    const dom = new DomPool(domHost);
    const canvas = new CanvasPool(canvasHost);
    dom.mount();
    canvas.mount();
    domPoolRef.current = dom;
    canvasPoolRef.current = canvas;
    syncCanvas();
    syncDom();
    return () => {
      canvas.clear();
      domPoolRef.current = null;
      canvasPoolRef.current = null;
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    };
  }, [syncCanvas, syncDom]);

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
      syncCanvas();
      syncDom();
      return;
    }
    const firstBuild = prevLayoutKeyRef.current === "";
    prevLayoutKeyRef.current = key;
    // DOM reflows immediately (it covers the viewport); canvas waits for settle.
    domPoolRef.current?.refreshLayout();
    syncDom();

    if (firstBuild) {
      // Initial size — no stale canvas to tear down; warm right away.
      const t = window.setTimeout(() => {
        startAtlasWarm();
        syncCanvas();
        syncDom();
      }, 120);
      return () => window.clearTimeout(t);
    }
    // A real size change (resize / orientation / preset) — drop the old canvas
    // now and rebuild SETTLE_MS after the viewport goes still.
    tearDownAndScheduleRebuild();
  }, [layout, startAtlasWarm, syncCanvas, syncDom, tearDownAndScheduleRebuild]);

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

  // Off-screen tickets stay painted. Scroll only moves the holes so a
  // live card, including one that is animating, never has canvas under it.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let idle = 0;
    const onScroll = () => {
      if (idle) return;
      idle = window.requestAnimationFrame(() => {
        idle = 0;
        syncDom();
        canvasPoolRef.current?.setSkip(domIds());
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (idle) window.cancelAnimationFrame(idle);
    };
  }, [syncDom, domIds]);

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

  const rebuildAtlas = () => {
    clearCellAtlas();
    prevLayoutKeyRef.current = "";
    setAtlasReady(0);
    setIdReady(0);
    startAtlasWarm();
  };

  // —— Dab / multiplier / gold demo controls (mutate tickets in place) ——
  useEffect(() => {
    const host = atlasHostRef.current;
    if (!host || tickets.length === 0) return;
    let cancelled = false;
    const amounts = [...new Set(tickets.map((t) => t.win).filter(Boolean))];
    void warmAmounts(host, amounts).then(() => {
      if (cancelled) return;
      canvasPoolRef.current?.refresh();
      syncCanvas();
    });
    return () => {
      cancelled = true;
    };
  }, [tickets, layout, syncCanvas]);

  const refreshStates = useCallback(() => {
    canvasPoolRef.current?.refresh();
    syncDom();
  }, [syncDom]);

  const drawBall = () => {
    if (tickets.length === 0 || drawRound >= DRAW_ROUND_COUNT) return;
    const spec = DRAW_ROUNDS[drawRound]!;
    const ball = pickDrawBall(tickets, drawnBallsRef.current, domIds());
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
    const host = atlasHostRef.current;
    if (host) {
      const amounts = [...new Set(tickets.map((ticket) => ticket.win).filter(Boolean))];
      void warmAmounts(host, amounts).then(() => {
        canvasPoolRef.current?.refresh();
        syncCanvas();
      });
    }
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

  // A-vs-B test: raw sprite <img> over a live DOM cell (no canvas).
  // Aligns → placement (A). Still high → SnapDOM foreignObject raster (B).
  useLayoutEffect(() => {
    const host = domHostRef.current;
    if (!host) return;
    let img = host.querySelector(
      "img.catalog__spriteOverlay",
    ) as HTMLImageElement | null;

    if (!spriteOverlay || atlasReady < 60) {
      img?.remove();
      setOverlayInfo("");
      return;
    }

    const cell = host.querySelector(".ticketCard__cell") as HTMLElement | null;
    if (!cell) {
      setOverlayInfo("no live cell yet — scroll/add tickets");
      return;
    }

    const n = Number.parseInt(cell.textContent?.trim() || "", 10);
    if (!Number.isFinite(n) || n < 1 || n > 60) {
      setOverlayInfo("cell text not a number");
      return;
    }

    const url = getCellSpriteDataUrl(n);
    const geo = getTicketGeometry();
    if (!url || !geo) {
      setOverlayInfo("sprite missing");
      return;
    }

    if (!img) {
      img = document.createElement("img");
      img.className = "catalog__spriteOverlay";
      img.alt = "";
      host.appendChild(img);
    }

    const cellR = cell.getBoundingClientRect();
    const hostR = host.getBoundingClientRect();
    img.src = url;
    img.style.position = "absolute";
    img.style.left = `${cellR.left - hostR.left + host.scrollLeft}px`;
    img.style.top = `${cellR.top - hostR.top + host.scrollTop}px`;
    img.style.width = `${geo.cellW}px`;
    img.style.height = `${geo.cellH}px`;
    img.style.imageRendering = "pixelated";
    img.style.opacity = "0.55";
    img.style.pointerEvents = "none";
    img.style.zIndex = "20";
    img.style.outline = "1px solid #e11";
    img.style.boxSizing = "border-box";

    setOverlayInfo(
      `overlay #${n} on live cell — if glyph still ↑ = SnapDOM (B); if aligned = placement (A)`,
    );
  }, [spriteOverlay, atlasReady, domCount, tickets.length, layout]);

  return (
    <div className="app" ref={cssHostRef}>
      <header className="toolbar">
        <h1>Cell atlas canvas POC</h1>
        <p className="toolbar__hint">
          +1 and +5 play the catalog appear gesture, then scroll to the bottom.
          +25 and +100 only scroll. Live rows stay DOM. Canvas paints the rows
          that have scrolled away. Up to {MAX_TICKETS} tickets.
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
          <button type="button" className="btn-ghost" onClick={rebuildAtlas}>
            Rebuild atlas
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
          <label className="stat">
            <input
              type="checkbox"
              checked={spriteOverlay}
              onChange={(e) => setSpriteOverlay(e.target.checked)}
            />{" "}
            sprite-over-DOM
          </label>
          {overlayInfo ? <span className="stat">{overlayInfo}</span> : null}
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
            cells <strong>{atlasReady}</strong>/65
            {atlasReady >= 65 ? " ✓" : "…"}
          </span>
          <span className="stat">
            digits <strong>{idReady}</strong>/30
            {idReady >= 30 ? " ✓" : "…"}
          </span>
          <span className="stat">
            dom <strong>{domCount}</strong>/{DOM_POOL_SIZE}
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
