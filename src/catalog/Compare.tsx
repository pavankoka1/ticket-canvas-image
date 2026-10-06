import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { resolveCatalogLayout, setActiveLayout } from "./catalogLayout";
import {
  applyCellBoxCssVars,
  resolveCellBoxModel,
  setLiveCellBoxModel,
} from "./cellBoxModel";
import { CompareDiagnostics } from "./compareDiagnostics";
import {
  COMPARE_RENDER_MODES,
  compareRasterRatio,
  isCompareRenderMode,
  setCompareRenderMode,
  type CompareRenderMode,
} from "./compareRenderMode";
import { preloadComparePack, scheduleCompareGlyphWarm } from "./compareCachedSprites";
import { CompareSvgStack } from "./compareSvgStack";
import { loadSvgMultiplierAssets } from "./compareSvgMultiplier";
import { ensureTicketFontsForLayout } from "./ticketFont";
import {
  TICKET_PRESETS,
  applyTicketCssVars,
  getPreset,
  type TicketMetrics,
  type TicketPresetId,
} from "./ticketPresets";
import type { Ticket } from "./tickets";

const NORMAL_TICKET: Ticket = {
  id: "cmp-normal",
  no: "8763",
  balls: [7, 14, 21, 28, 35, 42],
  hits: [],
  multipliers: {},
  win: "",
};

const DAB_TICKET: Ticket = {
  id: "cmp-dab",
  no: "6171",
  balls: [3, 11, 19, 27, 44, 58],
  hits: [1, 3, 4],
  multipliers: { 3: 5 },
  win: "$1,234.56",
};

const DISABLED_TICKET: Ticket = {
  id: "cmp-disabled",
  no: "2408",
  balls: [7, 19, 23, 31, 44, 58],
  hits: [3],
  multipliers: { 3: 3 },
  win: "",
  disabled: true,
};

const COMPARE_TICKETS: { title: string; ticket: Ticket }[] = [
  { title: "Normal ticket", ticket: NORMAL_TICKET },
  {
    title: `DAB + ${DAB_TICKET.multipliers[3]}× + ${DAB_TICKET.win}`,
    ticket: DAB_TICKET,
  },
  { title: "Disabled · 3× on 31", ticket: DISABLED_TICKET },
];

function layoutForPreset(metrics: TicketMetrics) {
  const isMobile = metrics.id.startsWith("mobile");
  const refWidth = isMobile ? 390 : 400;
  const isLandscape = !isMobile;
  return resolveCatalogLayout(isMobile, isLandscape, refWidth, metrics);
}

export function Compare() {
  const cssHostRef = useRef<HTMLDivElement>(null);
  const [presetId, setPresetId] = useState<TicketPresetId>("desktopMedium");
  const [readyPreset, setReadyPreset] = useState<TicketPresetId | null>(null);
  const paintGen = readyPreset === presetId ? 1 : 0;
  const [status, setStatus] = useState("warming…");
  const [canvasOpacity, setCanvasOpacity] = useState(1);
  const [blend, setBlend] = useState<"normal" | "difference">("difference");
  const [showDom, setShowDom] = useState(true);
  const [renderMode, setRenderMode] = useState<CompareRenderMode>("svg-all");
  // Module state read by the shared capture path; set before children render.
  setCompareRenderMode(renderMode);
  const rasterRatio = compareRasterRatio(renderMode);

  const metrics = getPreset(presetId);
  const layout = useMemo(() => layoutForPreset(metrics), [metrics]);

  useLayoutEffect(() => {
    setActiveLayout(layout);
    const model = resolveCellBoxModel(layout, rasterRatio);
    setLiveCellBoxModel(model);
    const host = cssHostRef.current;
    if (host) {
      applyTicketCssVars(host, layout.metrics, rasterRatio);
      applyCellBoxCssVars(host, model, layout.metrics);
    }
  }, [layout, rasterRatio, renderMode]);

  useEffect(() => {
    let cancelled = false;
    setReadyPreset(null);
    void (async () => {
      try {
        setStatus("loading fonts…");
        await ensureTicketFontsForLayout(layout.metrics);
        await loadSvgMultiplierAssets();
        setStatus("warming atlas…");
        const pack = await preloadComparePack(layout, rasterRatio);
        scheduleCompareGlyphWarm(layout, rasterRatio, pack);
        if (cancelled) return;
        setLiveCellBoxModel(resolveCellBoxModel(layout, rasterRatio));
        setReadyPreset(presetId);
        setStatus(
          `ready · ${metrics.label} · ${layout.cardWidth}×${layout.cardHeight} css · raster DPR ${rasterRatio}`,
        );
      } catch (err) {
        if (!cancelled) {
          setStatus(err instanceof Error ? `warm failed: ${err.message}` : "warm failed");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [layout, metrics.label, presetId, rasterRatio, renderMode]);

  const stackProps = {
    renderMode,
    cardWidth: layout.cardWidth,
    cardHeight: layout.cardHeight,
    metrics: layout.metrics,
    layout,
    paintGen,
    canvasOpacity,
    blend,
    showDom,
    showCanvas: true,
    nudgeX: 0,
    nudgeY: 0,
  };

  return (
    <div className="compare" ref={cssHostRef}>
      <header className="compare__toolbar">
        <div className="compare__nav">
          <a href="/">← catalog</a>
          <strong>Compare · DOM + foreignObject canvas</strong>
          <span className="compare__status">{status}</span>
        </div>
        <div className="compare__controls">
          <label>
            ticket size
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value as TicketPresetId)}
            >
              {TICKET_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            render mode
            <select
              value={renderMode}
              onChange={(e) => {
                if (isCompareRenderMode(e.target.value)) setRenderMode(e.target.value);
              }}
            >
              {COMPARE_RENDER_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            canvas overlay
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={canvasOpacity}
              onChange={(e) => setCanvasOpacity(Number(e.target.value))}
            />
            {canvasOpacity.toFixed(2)}
          </label>
          <label>
            blend
            <select
              value={blend}
              onChange={(e) =>
                setBlend(e.target.value as "normal" | "difference")
              }
            >
              <option value="difference">difference</option>
              <option value="normal">normal</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={showDom}
              onChange={(e) => setShowDom(e.target.checked)}
            />
            DOM
          </label>
        </div>
        <p className="compare__hint">
          Tickets share the live HTML and CSS, with embedded fonts and images.
          HTML layout uses CSS zoom at the canvas DPR. Difference at overlay
          1.0: visible marks show DOM differences. Optimized counters compare
          canvas RGBA bytes against the full-ticket row; zero is exact.
        </p>
      </header>

      <CompareDiagnostics />
      <h2 className="compare__rowTitle">Cached sprite stack</h2>
      <div className="compare__cases">
        {COMPARE_TICKETS.map(({ title, ticket }) => (
          <CompareSvgStack
            key={`optimized:${renderMode}:${presetId}:${ticket.id}`}
            {...stackProps}
            optimized
            ticket={ticket}
            title={`${title} (#${ticket.no})`}
          />
        ))}
      </div>
    </div>
  );
}
