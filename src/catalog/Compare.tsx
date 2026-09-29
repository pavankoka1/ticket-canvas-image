import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { activeDpr, applyCellBoxCssVars, setLiveCellBoxModel } from "./cellBoxModel";
import { resolveLiveCellBoxModel, warmCellAtlas } from "./cellAtlas";
import { resolveCatalogLayout, setActiveLayout } from "./catalogLayout";
import { CompareMinimalFoProbe } from "./compareMinimalFoProbe";
import { CompareSvgStack } from "./compareSvgStack";
import { warmCellBitmaps } from "./cellBitmaps";
import { warmIdDigits } from "./headerGlyphs";
import { ensureTicketFontsForLayout } from "./ticketFont";
import {
  applyTicketCssVars,
  getPreset,
  TICKET_PRESETS,
  type TicketPresetId,
  type TicketMetrics,
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
  const atlasHostRef = useRef<HTMLDivElement>(null);
  const [presetId, setPresetId] = useState<TicketPresetId>("desktopMedium");
  const [paintGen, setPaintGen] = useState(0);
  const [status, setStatus] = useState("warming…");
  const [canvasOpacity, setCanvasOpacity] = useState(0.55);
  const [blend, setBlend] = useState<"normal" | "difference">("difference");
  const [showDom, setShowDom] = useState(true);

  const metrics = getPreset(presetId);
  const layout = useMemo(() => layoutForPreset(metrics), [metrics]);

  useLayoutEffect(() => {
    setActiveLayout(layout);
    const model = resolveLiveCellBoxModel(layout);
    setLiveCellBoxModel(model);
    const host = cssHostRef.current;
    if (host) {
      applyTicketCssVars(host, layout.metrics);
      applyCellBoxCssVars(host, model, layout.metrics);
    }
  }, [layout]);

  useEffect(() => {
    let cancelled = false;
    setPaintGen(0);
    setStatus("loading fonts…");

    void (async () => {
      await ensureTicketFontsForLayout(layout.metrics);
      if (cancelled) return;
      setLiveCellBoxModel(resolveLiveCellBoxModel(layout, activeDpr()));
      setPaintGen((g) => g + 1);
      setStatus(
        `ready · ${metrics.label} · ${layout.cardWidth}×${layout.cardHeight} css · dpr ${activeDpr()}`,
      );

      const atlasHost = atlasHostRef.current;
      if (!atlasHost || cancelled) return;
      applyTicketCssVars(atlasHost, layout.metrics);
      void warmCellBitmaps(atlasHost);
      void warmIdDigits(atlasHost);
      void warmCellAtlas(atlasHost);
    })();

    return () => {
      cancelled = true;
    };
  }, [layout, metrics.label]);

  const stackProps = {
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
          FO probe (50×50 “100”) isolates text vs ticket chrome. Tickets use{" "}
          <code>rasterizeTicketSvg</code>. Difference @ overlay 1.0: flat black =
          pixel match; colored fringing = DOM vs blob-FO mismatch (often text ink
          or <code>zoom:dpr</code>, not stack position).
        </p>
      </header>

      <div className="compare__cases compare__cases_probes">
        <CompareMinimalFoProbe
          paintGen={paintGen}
          canvasOpacity={canvasOpacity}
          blend={blend}
          showDom={showDom}
          showCanvas={stackProps.showCanvas}
        />
      </div>

      <div className="compare__cases">
        {COMPARE_TICKETS.map(({ title, ticket }) => (
          <CompareSvgStack
            key={ticket.id}
            {...stackProps}
            ticket={ticket}
            title={`${title} (#${ticket.no})`}
          />
        ))}
      </div>

      <div ref={atlasHostRef} className="catalog__captureHost" />
    </div>
  );
}
