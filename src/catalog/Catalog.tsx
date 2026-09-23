import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
  contentHeight,
  contentWidth,
  getActiveLayout,
  resolveCatalogLayout,
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
import {
  CATALOG_VIEWPORT_HEIGHT,
  DOM_POOL_SIZE,
  MAX_TICKETS,
  ROW_BUFFER,
} from "./layout";
import {
  buildSlots,
  createTickets,
  MULTIPLIER_VALUES,
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
  const [spriteOverlay, setSpriteOverlay] = useState(false);
  const [overlayInfo, setOverlayInfo] = useState<string>("");
  const [availWidth, setAvailWidth] = useState(1000);
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
  const layout = useMemo(
    () => resolveCatalogLayout(isMobile, isLandscape, availWidth, metrics),
    [isMobile, isLandscape, availWidth, metrics],
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

  slotsRef.current = slots;
  ticketsByIdRef.current = ticketsById;

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
    dom.rebind(domSlots, ticketsByIdRef.current);
    setDomCount(domSlots.length);
  }, []);

  /** Paint / extend full-catalog canvas tiles. Not tied to scroll. */
  const syncCanvas = useCallback(() => {
    const canvas = canvasPoolRef.current;
    if (!canvas?.isReady) return;
    canvas.setCatalog(slotsRef.current, ticketsByIdRef.current);
    setTileCount(canvas.tileCount);
  }, []);

  const revealCanvas = useCallback(() => {
    const host = canvasHostRef.current;
    if (host) host.style.visibility = "visible";
  }, []);

  const hideCanvas = useCallback(() => {
    const host = canvasHostRef.current;
    if (host) host.style.visibility = "hidden";
  }, []);

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
    })();
  }, [syncCanvas, syncDom, revealCanvas]);

  const scrollToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = Math.max(
      0,
      container.scrollHeight - container.clientHeight,
    );
  }, []);

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
    const el = scrollRef.current;
    if (!el) return;
    let first = true;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      // Any width change past the first (mount) reading is a viewport shift:
      // hide the canvas instantly so the old-size underlay can't flash behind
      // the reflowing DOM. The layout-change effect schedules the rebuild.
      if (!first) hideCanvas();
      first = false;
      setAvailWidth(Math.max(0, Math.floor(w - 24)));
    });
    ro.observe(el);
    setAvailWidth(Math.max(0, Math.floor(el.clientWidth - 24)));
    return () => ro.disconnect();
  }, [hideCanvas]);

  useEffect(() => {
    const onShift = () => {
      hideCanvas(); // vanish the stale canvas before React re-renders
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
      canvasPoolRef.current?.clear();
      setTileCount(0);
      syncDom();
      return;
    }
    scrollToBottom();
    syncCanvas();
    syncDom();
  }, [tickets, height, syncCanvas, syncDom, scrollToBottom]);

  // While the finger or wheel is moving, the live cards hide and the canvas
  // is the catalog. They come back once scrolling has stopped.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let idle = 0;
    const onScroll = () => {
      canvasPoolRef.current?.pause();
      domPoolRef.current?.setVisible(false);
      if (idle) window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        idle = 0;
        canvasPoolRef.current?.resume();
        syncDom();
        domPoolRef.current?.setVisible(true);
      }, 160);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (idle) window.clearTimeout(idle);
      canvasPoolRef.current?.resume();
      domPoolRef.current?.setVisible(true);
    };
  }, [syncDom]);

  const addHundred = () => {
    setTickets((prev) => {
      const room = MAX_TICKETS - prev.length;
      if (room <= 0) return prev;
      return [...prev, ...createTickets(Math.min(100, room))];
    });
  };

  const reset = () => {
    setTickets([]);
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

  const addDab = () => {
    for (const t of tickets) {
      const unhit = [0, 1, 2, 3, 4, 5].filter((c) => !t.hits.includes(c));
      if (!unhit.length) continue;
      t.hits.push(unhit[Math.floor(Math.random() * unhit.length)]!);
    }
    refreshStates();
  };

  const addMultiplier = () => {
    for (const t of tickets) {
      let cell = t.hits.find((c) => !(c in t.multipliers));
      if (cell === undefined) {
        const unhit = [0, 1, 2, 3, 4, 5].filter((c) => !t.hits.includes(c));
        if (!unhit.length) continue;
        cell = unhit[Math.floor(Math.random() * unhit.length)]!;
        t.hits.push(cell);
      }
      t.multipliers[cell] =
        MULTIPLIER_VALUES[
          Math.floor(Math.random() * MULTIPLIER_VALUES.length)
        ]!;
    }
    refreshStates();
  };

  const clearStates = () => {
    for (const t of tickets) {
      t.hits = [];
      t.multipliers = {};
    }
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
          Scrolling shows the canvas. Live cards return when scrolling stops.
          Up to {MAX_TICKETS} tickets.
          {" · "}
          <a href="/compare">DOM↔Canvas compare</a>
        </p>
        <div className="toolbar__row">
          <button
            type="button"
            onClick={addHundred}
            disabled={tickets.length >= MAX_TICKETS}
          >
            +100 tickets
          </button>
          <button type="button" className="btn-ghost" onClick={reset}>
            Reset
          </button>
          <button type="button" className="btn-ghost" onClick={rebuildAtlas}>
            Rebuild atlas
          </button>
          <button type="button" className="btn-ghost" onClick={addDab}>
            + Dab
          </button>
          <button type="button" className="btn-ghost" onClick={addMultiplier}>
            + Multiplier
          </button>
          <button type="button" className="btn-ghost" onClick={clearStates}>
            Clear states
          </button>
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
            digits <strong>{idReady}</strong>/20
            {idReady >= 20 ? " ✓" : "…"}
          </span>
          <span className="stat">
            dom <strong>{domCount}</strong>/{DOM_POOL_SIZE}
          </span>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="catalog"
        style={{
          height: CATALOG_VIEWPORT_HEIGHT,
          flex: "0 0 auto",
          minHeight: CATALOG_VIEWPORT_HEIGHT,
        }}
      >
        <div
          ref={contentRef}
          className="catalog__content"
          style={{
            width: `${width}px`,
            height: `${height}px`,
            minHeight: height > 0 ? undefined : 80,
          }}
        >
          <div ref={canvasHostRef} className="catalog__canvas" aria-hidden />
          <div ref={domHostRef} className="catalog__dom" />
        </div>
      </div>
      <div ref={atlasHostRef} className="catalog__captureHost" />
      <div ref={badgeHostRef} className="catalog__captureHost" />
      <div ref={idHostRef} className="catalog__captureHost" />
      <div ref={prewarmHostRef} className="catalog__captureHost" />
    </div>
  );
}
