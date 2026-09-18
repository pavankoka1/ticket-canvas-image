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
  applyCellBoxCssVars,
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
  cellAtlasSize,
  clearCellAtlas,
  getCellSpriteDataUrl,
  getTicketGeometry,
  warmCellAtlas,
  type AtlasSource,
} from "./cellAtlas";
import { DomPool } from "./DomPool";
import {
  CATALOG_VIEWPORT_HEIGHT,
  DOM_POOL_SIZE,
  DOM_SCROLL_THROTTLE_MS,
  ROW_BUFFER,
} from "./layout";
import {
  buildSlots,
  createTickets,
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

function layoutCacheKey(layout: ReturnType<typeof getActiveLayout>): string {
  return `${layout.metrics.id}|${layout.cardWidth}|${layout.columns}|${layout.cardHeight}`;
}

export function Catalog() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const domHostRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const atlasHostRef = useRef<HTMLDivElement>(null);
  const cssHostRef = useRef<HTMLDivElement>(null);
  const domPoolRef = useRef<DomPool | null>(null);
  const canvasPoolRef = useRef<CanvasPool | null>(null);
  const slotsRef = useRef<TicketSlot[]>([]);
  const ticketsByIdRef = useRef<Map<string, Ticket>>(new Map());
  const atlasGenRef = useRef(0);
  const prevLayoutKeyRef = useRef("");
  const domThrottleRef = useRef(0);
  const domPendingRef = useRef(false);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [atlasReady, setAtlasReady] = useState(0);
  const [atlasSource, setAtlasSource] = useState<AtlasSource>("empty");
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
    const model = resolveCellBoxModel(layout);
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

  const scheduleDomSync = useCallback(() => {
    if (domThrottleRef.current) {
      domPendingRef.current = true;
      return;
    }
    syncDom();
    domThrottleRef.current = window.setTimeout(() => {
      domThrottleRef.current = 0;
      if (domPendingRef.current) {
        domPendingRef.current = false;
        syncDom();
      }
    }, DOM_SCROLL_THROTTLE_MS);
  }, [syncDom]);

  /** Paint / extend full-catalog canvas tiles. Not tied to scroll. */
  const syncCanvas = useCallback(() => {
    const canvas = canvasPoolRef.current;
    if (!canvas?.isReady) return;
    canvas.setCatalog(slotsRef.current, ticketsByIdRef.current);
    setTileCount(canvas.tileCount);
  }, []);

  const startAtlasWarm = useCallback(() => {
    const host = atlasHostRef.current;
    if (!host) return;
    applyTicketCssVars(host, getActiveLayout().metrics);
    const gen = ++atlasGenRef.current;
    let lastUi = 0;
    void warmCellAtlas(host, (ready, source) => {
      if (gen !== atlasGenRef.current) return;
      const now = performance.now();
      if (now - lastUi > 40 || ready >= 60) {
        lastUi = now;
        setAtlasReady(ready);
        setAtlasSource(source);
        canvasPoolRef.current?.refresh();
      }
    }).then((source) => {
      if (gen !== atlasGenRef.current) return;
      if (source === "empty") return;
      setAtlasReady(cellAtlasSize());
      setAtlasSource(source);
      canvasPoolRef.current?.refresh();
      syncCanvas();
      syncDom();
    });
  }, [syncCanvas, syncDom]);

  const scrollToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = Math.max(
      0,
      container.scrollHeight - container.clientHeight,
    );
  }, []);

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
      if (domThrottleRef.current) window.clearTimeout(domThrottleRef.current);
    };
  }, [syncCanvas, syncDom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setAvailWidth(Math.max(0, Math.floor(w - 24)));
    });
    ro.observe(el);
    setAvailWidth(Math.max(0, Math.floor(el.clientWidth - 24)));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onResize = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const key = layoutCacheKey(layout);
    if (key === prevLayoutKeyRef.current) {
      domPoolRef.current?.refreshLayout();
      syncCanvas();
      syncDom();
      return;
    }
    prevLayoutKeyRef.current = key;
    domPoolRef.current?.refreshLayout();
    const t = window.setTimeout(() => {
      startAtlasWarm();
      syncCanvas();
      syncDom();
    }, 120);
    return () => window.clearTimeout(t);
  }, [layout, startAtlasWarm, syncCanvas, syncDom]);

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

  // Scroll: canvas tiles already cover the catalog — only throttle DOM translates.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => scheduleDomSync();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [scheduleDomSync]);

  const addHundred = () => {
    setTickets((prev) => [...prev, ...createTickets(100)]);
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
    setAtlasSource("empty");
    setAtlasReady(0);
    startAtlasWarm();
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
          cellW=(ticketWidth−6)/6. Atlas stores measured cell tops. Rebuild
          atlas, check console [YDRIFT], then toggle sprite-over-DOM on Linux.
        </p>
        <div className="toolbar__row">
          <button type="button" onClick={addHundred}>
            +100 tickets
          </button>
          <button type="button" className="btn-ghost" onClick={reset}>
            Reset
          </button>
          <button type="button" className="btn-ghost" onClick={rebuildAtlas}>
            Rebuild atlas
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
            tickets <strong>{tickets.length}</strong>
          </span>
          <span className="stat">
            tiles <strong>{tileCount}</strong>
          </span>
          <span className="stat">
            atlas <strong>{atlasReady}</strong>/60
            {atlasReady >= 60 ? " ✓" : "…"}{" "}
            <strong>
              {atlasSource === "ram"
                ? "RAM"
                : atlasSource === "idb"
                  ? "IDB"
                  : atlasSource === "snap"
                    ? "SnapDOM"
                    : "—"}
            </strong>
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
    </div>
  );
}
