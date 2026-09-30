/**
 * Compare: live DOM + SVG foreignObject raster — mirrors fix/restore-catalog-alignment SvgRasterStack.
 */

import { useLayoutEffect, useRef, useState } from "react";

import { activeDpr, resolveCellBoxModel, setLiveCellBoxModel } from "./cellBoxModel";
import {
  layoutCompareRasterCanvas,
  styleCompareTicketDom,
} from "./compareDomAlign";
import { TicketCard } from "./ticketCardElement";
import { rasterizeCompareTicketSvg } from "./ticketSvgRaster";
import { setActiveLayout } from "./catalogLayout";
import type { CatalogLayout } from "./catalogLayout";
import type { TicketMetrics } from "./ticketPresets";
import type { Ticket } from "./tickets";

export type CompareSvgStackProps = {
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

export function CompareSvgStack({
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

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const align = () => {
      wrap.style.left = "0px";
      wrap.style.top = "0px";
      const rect = wrap.getBoundingClientRect();
      const dpr = activeDpr();
      wrap.style.left = `${Math.round(rect.left * dpr) / dpr - rect.left}px`;
      wrap.style.top = `${Math.round(rect.top * dpr) / dpr - rect.top}px`;
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
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
    setLiveCellBoxModel(resolveCellBoxModel(layout));
    card.bind(ticket, 0, 0, layout);
    card.dom.classList.add("ticketCard_compare");
    styleCompareTicketDom(card.dom);
    card.dom.style.visibility = showDom ? "visible" : "hidden";
    card.dom.style.zIndex = "1";
    if (!wrap.contains(card.dom)) {
      wrap.insertBefore(card.dom, canvas);
    }
  });

  useLayoutEffect(() => {
    if (paintGen < 1) return;

    let cancelled = false;
    const dpr = activeDpr();

    void (async () => {
      const card = cardRef.current;
      const c = canvasRef.current;
      const wrap = wrapRef.current;
      if (!card || !c || !wrap || cancelled) return;
      if (!wrap.contains(card.dom)) return;

      try {
        setNote("rasterizing SVG…");
        const raw = await rasterizeCompareTicketSvg(card.dom, dpr, metrics);
        if (cancelled) return;
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
        setNote(`${raw.width}×${raw.height} svg raster`);
      } catch (err: unknown) {
        if (!cancelled) setNote(err instanceof Error ? err.message : "svg failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ticket, cardWidth, cardHeight, metrics, layout, paintGen]);

  return (
    <section className="compare__fullSnap">
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
