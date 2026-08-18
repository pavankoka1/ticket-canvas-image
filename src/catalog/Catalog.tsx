import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { bakeTicketsInBackground } from './bakeQueue';
import { computeCatalogBands } from './bands';
import { bitmapCacheSize, clearTicketBitmaps, hasTicketBitmap } from './bitmapCache';
import { CanvasPool } from './CanvasPool';
import {
  DEFAULT_SHEET_CAPACITY,
  DomCaptureStage,
  SHEET_SIZE_OPTIONS,
} from './DomCaptureStage';
import { DomPool } from './DomPool';
import {
  CANVAS_BAND_CAPACITY,
  CARD_HEIGHT,
  CARD_WIDTH,
  CATALOG_VIEWPORT_HEIGHT,
  COLUMNS,
  COLUMN_GAP,
  contentHeight,
  contentWidth,
  ROW_BUFFER,
  ROW_GAP,
} from './layout';
import { buildSlots, createTickets, type Ticket, type TicketSlot } from './tickets';

export function Catalog() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const domHostRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const captureHostRef = useRef<HTMLDivElement>(null);
  const domPoolRef = useRef<DomPool | null>(null);
  const canvasPoolRef = useRef<CanvasPool | null>(null);
  const captureStageRef = useRef<DomCaptureStage | null>(null);
  const slotsRef = useRef<TicketSlot[]>([]);
  const ticketsByIdRef = useRef<Map<string, Ticket>>(new Map());
  const bandStatsRef = useRef({ dom: 0, above: 0, below: 0, canvas: 0 });
  /** Bumps on reset so in-flight bakers stop updating UI. */
  const bakeGenRef = useRef(0);
  const bakePendingRef = useRef(0);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [bakeDone, setBakeDone] = useState(0);
  const [bakeTotal, setBakeTotal] = useState(0);
  const [cacheCount, setCacheCount] = useState(0);
  const [bandStats, setBandStats] = useState({ dom: 0, above: 0, below: 0, canvas: 0 });
  const [sheetSize, setSheetSize] = useState(DEFAULT_SHEET_CAPACITY);

  const slots = useMemo(
    () => buildSlots(tickets, COLUMNS, CARD_WIDTH, CARD_HEIGHT, COLUMN_GAP, ROW_GAP),
    [tickets]
  );
  const ticketsById = useMemo(() => new Map(tickets.map((t) => [t.id, t])), [tickets]);
  const height = contentHeight(tickets.length);
  const width = contentWidth();
  const cacheReady = tickets.length > 0 && tickets.every((t) => hasTicketBitmap(t.id));
  const isBaking = bakeTotal > 0 && bakeDone < bakeTotal;

  slotsRef.current = slots;
  ticketsByIdRef.current = ticketsById;

  const syncBands = useCallback((forceCanvasPaint = false) => {
    const container = scrollRef.current;
    const dom = domPoolRef.current;
    const canvas = canvasPoolRef.current;
    if (!container || !dom?.isReady || !canvas) return;

    const bands = computeCatalogBands(
      slotsRef.current,
      container.scrollTop,
      container.clientHeight,
      ROW_BUFFER
    );

    // Viewport DOM immediately; canvas underlay paints whatever is already cached.
    dom.rebind(bands.dom, ticketsByIdRef.current);
    canvas.rebind(bands.canvas, forceCanvasPaint);

    const next = {
      dom: bands.dom.length,
      above: bands.above,
      below: bands.below,
      canvas: bands.canvas.length,
    };
    const prev = bandStatsRef.current;
    if (
      prev.dom !== next.dom ||
      prev.above !== next.above ||
      prev.below !== next.below ||
      prev.canvas !== next.canvas
    ) {
      bandStatsRef.current = next;
      setBandStats(next);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  }, []);

  useEffect(() => {
    const domHost = domHostRef.current;
    const canvasHost = canvasHostRef.current;
    const captureHost = captureHostRef.current;
    if (!domHost || !canvasHost || !captureHost) return;
    const dom = new DomPool(domHost);
    const canvas = new CanvasPool(canvasHost);
    const capture = new DomCaptureStage(captureHost);
    dom.mount();
    canvas.mount();
    capture.mount();
    domPoolRef.current = dom;
    canvasPoolRef.current = canvas;
    captureStageRef.current = capture;
    syncBands();
    return () => {
      domPoolRef.current = null;
      canvasPoolRef.current = null;
      captureStageRef.current = null;
    };
  }, [syncBands]);

  useEffect(() => {
    captureStageRef.current?.setSheetCapacity(sheetSize);
  }, [sheetSize]);

  // Add → grow height → scroll to newest DOM rows.
  useLayoutEffect(() => {
    if (tickets.length === 0) {
      syncBands();
      return;
    }
    scrollToBottom();
    syncBands(true);
  }, [tickets, height, syncBands, scrollToBottom]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => syncBands();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [syncBands]);

  const addHundred = () => {
    const stage = captureStageRef.current;
    if (!stage?.isReady) return;

    const batch = createTickets(100);
    const gen = bakeGenRef.current;

    // 1) DOM first — button stays free; layout effect scrolls to bottom.
    setTickets((prev) => [...prev, ...batch]);
    bakePendingRef.current += batch.length;
    setBakeTotal(bakePendingRef.current);

    // 2) Background sheet bake — many tickets per SnapDOM; never blocks the button.
    let lastUi = 0;
    void bakeTicketsInBackground(stage, batch, (p) => {
      if (gen !== bakeGenRef.current) return;
      const cached = bitmapCacheSize();
      if (p.lastIds?.length) {
        canvasPoolRef.current?.refreshFromCache(p.lastIds);
      }
      const now = performance.now();
      if (now - lastUi > 50 || p.done === p.total) {
        lastUi = now;
        setCacheCount(cached);
        setBakeDone(cached);
        syncBands(true);
      }
    }).then(() => {
      if (gen !== bakeGenRef.current) return;
      const cached = bitmapCacheSize();
      setCacheCount(cached);
      setBakeDone(cached);
      canvasPoolRef.current?.refreshFromCache(batch.map((t) => t.id));
      syncBands(true);
    });
  };

  const reset = () => {
    bakeGenRef.current += 1;
    bakePendingRef.current = 0;
    clearTicketBitmaps();
    setTickets([]);
    setBakeDone(0);
    setBakeTotal(0);
    setCacheCount(0);
    setBandStats({ dom: 0, above: 0, below: 0, canvas: 0 });
    bandStatsRef.current = { dom: 0, above: 0, below: 0, canvas: 0 };
    syncBands();
  };

  return (
    <div className="app">
      <header className="toolbar">
        <h1>Canvas bitmap cache POC</h1>
        <p className="toolbar__hint">
          Click → DOM + scroll now. SnapDOM sheets on main; crops in a worker. Viewport{' '}
          {CATALOG_VIEWPORT_HEIGHT}px · 1 canvas layer (≤{CANVAS_BAND_CAPACITY} draws). Change{' '}
          <strong>tickets / SnapDOM</strong> to trade hitch length vs bake speed (1 = shortest
          freeze, 25 = fewest SnapDOM calls).
        </p>
        <div className="toolbar__row">
          <button type="button" onClick={addHundred}>
            +100 tickets
          </button>
          <button type="button" className="btn-ghost" onClick={reset}>
            Reset
          </button>
          <label className="stat toolbar__sheet">
            tickets / SnapDOM{' '}
            <select
              value={sheetSize}
              onChange={(e) => {
                const n = Number(e.target.value);
                setSheetSize(n);
                captureStageRef.current?.setSheetCapacity(n);
              }}
            >
              {SHEET_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className="stat">
            tickets <strong>{tickets.length}</strong>
          </span>
          <span className="stat">
            cache <strong>{cacheCount}</strong>
            {cacheReady ? ' ✓' : ''}
          </span>
          <span className="stat">
            dom <strong>{bandStats.dom}</strong>
          </span>
          <span className="stat">
            canvas <strong>{bandStats.canvas}</strong> (↑{bandStats.above} ↓{bandStats.below})
          </span>
          {isBaking && (
            <span className="stat bake">
              baking {Math.min(bakeDone, bakeTotal)}/{bakeTotal}
            </span>
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="catalog"
        style={{ height: CATALOG_VIEWPORT_HEIGHT, flex: '0 0 auto', minHeight: CATALOG_VIEWPORT_HEIGHT }}
      >
        <div
          ref={contentRef}
          className="catalog__content"
          style={{ width: `${width}px`, height: `${height}px`, minHeight: height > 0 ? undefined : 80 }}
        >
          <div ref={canvasHostRef} className="catalog__canvas" aria-hidden />
          <div ref={domHostRef} className="catalog__dom" />
        </div>
      </div>
      <div ref={captureHostRef} className="catalog__captureHost" />
    </div>
  );
}
