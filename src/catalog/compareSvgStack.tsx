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
import { assembleCompareSprites } from "./compareCachedSprites";
import { rasterizeCompareTicketSvg } from "./ticketSvgRaster";
import { setActiveLayout } from "./catalogLayout";
import type { CatalogLayout } from "./catalogLayout";
import type { TicketMetrics } from "./ticketPresets";
import type { Ticket } from "./tickets";

export type CompareSvgStackProps = {
  optimized?: boolean;
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
  optimized = false,
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
    // Compare follows the original CSS image sizing, independent of whether
    // the catalog image loader happened to be ready at the first bind.
    card.dom.querySelectorAll<HTMLElement>('.ticketCard__badgeHost').forEach(badge => {
      badge.style.backgroundSize = 'contain';
      badge.style.backgroundPosition = '0 0';
    });
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
        const raw = optimized
          ? await assembleCompareSprites(card.dom, ticket, layout, dpr)
          : await rasterizeCompareTicketSvg(card.dom, dpr, metrics);
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
        c.dataset.ready = "true";
        let diagnostic = "";
        if (optimized) {
          const reference = document.querySelector<HTMLCanvasElement>(
            `[data-renderer="full"][data-ticket="${ticket.id}"] canvas`,
          );
          if (reference?.dataset.ready === "true" && reference.width === raw.width && reference.height === raw.height) {
            try {
              const expected = reference.getContext('2d')!.getImageData(0, 0, raw.width, raw.height).data;
              const actual = ctx.getImageData(0, 0, raw.width, raw.height).data;
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
              diagnostic = ` · vs full: ${changed} pixels, max Δ ${maxDelta}`;
            } catch {
              diagnostic = ' · pixel readback unavailable';
            }
          } else diagnostic = ' · full reference not ready';
        }
        setNote(`${raw.width}×${raw.height} · ${optimized ? "cached sprites" : "full ticket blob"}${diagnostic}`);
      } catch (err: unknown) {
        if (!cancelled) setNote(err instanceof Error ? err.message : "svg failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ticket, cardWidth, cardHeight, metrics, layout, paintGen, optimized]);

  return (
    <section data-renderer={optimized ? "optimized" : "full"} data-ticket={ticket.id} className="compare__fullSnap" style={{ width: Math.max(cardWidth, 270) }}>
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
