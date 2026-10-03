/**
 * Compare: live DOM + SVG foreignObject raster — mirrors fix/restore-catalog-alignment SvgRasterStack.
 */

import { useLayoutEffect, useRef, useState } from "react";

import { activeDpr, resolveCellBoxModel, setLiveCellBoxModel } from "./cellBoxModel";
import { compareRasterRatio, type CompareRenderMode } from "./compareRenderMode";
import {
  alignCompareStackOrigin,
  layoutCompareRasterCanvas,
  styleCompareTicketDom,
} from "./compareDomAlign";
import { TicketCard } from "./ticketCardElement";
import { assembleCompareSprites, prepareCompareCard } from "./compareCachedSprites";
import { rasterizeCompareTicketSvg } from "./ticketSvgRaster";
import { setActiveLayout } from "./catalogLayout";
import type { CatalogLayout } from "./catalogLayout";
import type { TicketMetrics } from "./ticketPresets";
import type { Ticket } from "./tickets";

export type CompareSvgStackProps = {
  optimized?: boolean;
  renderMode: CompareRenderMode;
  ticket: Ticket;
  title: string;
  cardWidth: number;
  cardHeight: number;
  metrics: TicketMetrics;
  layout: CatalogLayout;
  paintGen: number;
  canvasOpacity: number;
  blend: "normal" | "difference";
  showDom: boolean;
  showCanvas: boolean;
  nudgeX: number;
  nudgeY: number;
};

function canvasPixelDiagnostic(canvas: HTMLCanvasElement, ticketId: string): string {
  const reference = document.querySelector<HTMLCanvasElement>(`[data-renderer="full"][data-ticket="${ticketId}"] canvas`);
  if (reference?.dataset.ready !== 'true' || reference.width !== canvas.width || reference.height !== canvas.height) return ' · waiting for full reference';
  try {
    const expected = reference.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const actual = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let changed = 0;
    let maxDelta = 0;
    for (let i = 0; i < actual.length; i += 4) {
      let different = false;
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(actual[i + channel]! - expected[i + channel]!);
        if (delta) different = true;
        maxDelta = Math.max(maxDelta, delta);
      }
      if (different) changed++;
    }
    return ` · vs full: ${changed} pixels, max Δ ${maxDelta}`;
  } catch { return ' · pixel readback unavailable'; }
}

export function CompareSvgStack({
  optimized = false,
  renderMode,
  ticket,
  title,
  cardWidth,
  cardHeight,
  metrics,
  layout,
  paintGen,
  canvasOpacity,
  blend,
  showDom,
  showCanvas,
  nudgeX,
  nudgeY,
}: CompareSvgStackProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<TicketCard | null>(null);
  const [note, setNote] = useState("waiting for the live card…");
  const alignRef = useRef<() => string>(() => "");

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    // WebKit rounds DOM text against the card's layout origin (iPhone, DPR 3):
    // a fractional origin moves header glyphs a whole device px. Put the
    // layout origin on a whole CSS px in document coordinates. Any device
    // remainder (non-zero only for a fractional ratio) goes in a transform,
    // which DOM and canvas share. Returns the alignment key captures check.
    const align = () => alignCompareStackOrigin(wrap);
    alignRef.current = align;
    align();
    const observer = new ResizeObserver(align);
    observer.observe(document.documentElement);
    const compare = wrap.closest('.compare');
    if (compare) observer.observe(compare);
    if (wrap.parentElement) observer.observe(wrap.parentElement);
    window.addEventListener('resize', align);
    window.visualViewport?.addEventListener('resize', align);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', align);
      window.visualViewport?.removeEventListener('resize', align);
    };
  });

  // Re-attach every commit: React only owns <canvas>; slider/blend updates drop the card otherwise.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let card = cardRef.current;
    if (!card) {
      card = new TicketCard();
      cardRef.current = card;
    }
    setActiveLayout(layout);
    setLiveCellBoxModel(resolveCellBoxModel(layout, activeDpr()));
    card.bind(ticket, 0, 0, layout);
    card.dom.classList.add("ticketCard_compare");
    styleCompareTicketDom(card.dom);
    // Live DOM and captured cells share the same geometry at the chosen ratio.
    prepareCompareCard(card, layout, activeDpr());
    card.dom.style.visibility = showDom ? "visible" : "hidden";
    card.dom.style.zIndex = "1";
    if (!wrap.contains(card.dom)) {
      wrap.insertBefore(card.dom, canvas);
    }
  });

  useLayoutEffect(() => {
    if (paintGen < 1) return;

    let cancelled = false;
    const dpr = compareRasterRatio(renderMode);
    const refreshDiagnostic = () => {
      const canvas = canvasRef.current;
      if (!cancelled && optimized && canvas?.dataset.ready === 'true') {
        setNote(`${canvas.width}×${canvas.height} · cached sprites${canvasPixelDiagnostic(canvas, ticket.id)}`);
      }
    };
    if (optimized) document.addEventListener('compare-full-ready', refreshDiagnostic);

    void (async () => {
      const card = cardRef.current;
      const c = canvasRef.current;
      const wrap = wrapRef.current;
      if (!card || !c || !wrap || cancelled) return;
      if (!wrap.contains(card.dom)) return;

      try {
        setNote("rasterizing SVG…");
        // Capture only from a settled layout: fonts loaded and origin aligned
        // before any DOM measurement, and unchanged when the bitmap is ready.
        // A moved origin (resize, reflow above) restarts the capture.
        let raw: HTMLCanvasElement | null = null;
        let alignKey = "";
        for (let attempt = 0; attempt < 3 && !raw; attempt++) {
          await document.fonts.ready;
          if (cancelled) return;
          alignKey = alignRef.current();
          const shot = optimized
            ? await assembleCompareSprites(card.dom, ticket, layout, dpr)
            : await rasterizeCompareTicketSvg(card.dom, dpr, metrics);
          if (cancelled) return;
          const settled = alignRef.current() === alignKey;
          console.debug("[compare-capture]", { renderer: optimized ? "optimized" : "full", ticket: ticket.id, attempt, alignKey, settled });
          if (settled) raw = shot;
        }
        if (!raw) {
          setNote("layout kept moving during capture");
          return;
        }
        c.dataset.alignKey = alignKey;
        if (raw.width < 1 || raw.height < 1) {
          setNote("svg raster: empty bitmap");
          return;
        }
        layoutCompareRasterCanvas(c, raw, cardWidth, cardHeight);
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(raw, 0, 0);
        c.dataset.ready = "true";
        const diagnostic = optimized ? canvasPixelDiagnostic(c, ticket.id) : "";
        if (!optimized) document.dispatchEvent(new Event("compare-full-ready"));
        setNote(`${raw.width}×${raw.height} · ${optimized ? "cached sprites" : "full ticket blob"}${diagnostic}`);
      } catch (err: unknown) {
        if (!cancelled) setNote(err instanceof Error ? err.message : "svg failed");
      }
    })();

    return () => {
      cancelled = true;
      document.removeEventListener('compare-full-ready', refreshDiagnostic);
    };
  }, [ticket, cardWidth, cardHeight, metrics, layout, paintGen, optimized, renderMode]);

  return (
    <section data-renderer={optimized ? "optimized" : "full"} data-ticket={ticket.id} data-scale-mode="html-zoom" data-render-mode={renderMode} data-raster-ratio={compareRasterRatio(renderMode)} className="compare__fullSnap" style={{ width: Math.max(cardWidth, 270) }}>
      <h2 className="compare__caseTitle">{title}</h2>
      <p className="compare__snapNote">{note}</p>
      <div
        ref={wrapRef}
        className="compare__stack"
        style={{ width: cardWidth, height: cardHeight, overflow: "hidden" }}
      >
        <canvas
          ref={canvasRef}
          className="compare__canvas"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            opacity: showCanvas && paintGen > 0 ? canvasOpacity : 0,
            mixBlendMode: blend,
            transform: `translate(${nudgeX}px, ${nudgeY}px)`,
          }}
        />
      </div>
    </section>
  );
}
