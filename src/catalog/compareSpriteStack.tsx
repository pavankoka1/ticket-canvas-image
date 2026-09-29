/**
 * Compare: live HTML TicketCard + sprite canvas (paintCatalogTicket / paintTicket).
 * This is the path that matched DOM on fix/restore-catalog-alignment.
 */

import { useLayoutEffect, useRef } from "react";

import { paintTicket } from "./CanvasPool";
import { activeDpr, getLiveCellBoxModel } from "./cellBoxModel";
import { getTicketGeometry, resolveLiveCellBoxModel } from "./cellAtlas";
import { TicketCard } from "./ticketCardElement";
import type { CatalogLayout } from "./catalogLayout";
import type { Ticket } from "./tickets";
import type { TicketSlot } from "./tickets";

export type CompareSpriteStackProps = {
  ticket: Ticket;
  title: string;
  cardWidth: number;
  cardHeight: number;
  layout: CatalogLayout;
  paintGen: number;
  canvasOpacity: number;
  blend: "normal" | "difference";
  showDom: boolean;
  showCanvas: boolean;
  nudgeX: number;
  nudgeY: number;
};

export function CompareSpriteStack({
  ticket,
  title,
  cardWidth,
  cardHeight,
  layout,
  paintGen,
  canvasOpacity,
  blend,
  showDom,
  showCanvas,
  nudgeX,
  nudgeY,
}: CompareSpriteStackProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<TicketCard | null>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let card = cardRef.current;
    if (!card) {
      card = new TicketCard();
      cardRef.current = card;
      wrap.appendChild(card.dom);
    }
    card.bind(ticket, 0, 0, layout);
    card.dom.style.visibility = showDom ? "visible" : "hidden";
    card.dom.style.zIndex = "1";
  }, [ticket, showDom, cardWidth, cardHeight, layout, paintGen]);

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c || paintGen < 1) return;
    const dpr = activeDpr();
    const { metrics } = layout;
    const geo = getTicketGeometry();
    const live = getLiveCellBoxModel() ?? resolveLiveCellBoxModel(layout, dpr);
    const useSprites = Boolean(
      geo && geo.cardWidth === cardWidth && geo.cellH === live.cellH,
    );
    const boxes = geo && geo.cardWidth === cardWidth ? geo.cells : live.cells;

    const bw = Math.round(cardWidth * dpr);
    const bh = Math.round(cardHeight * dpr);
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    c.style.width = `${cardWidth}px`;
    c.style.height = `${cardHeight}px`;

    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cardWidth, cardHeight);
    ctx.imageSmoothingEnabled = false;

    const slot: TicketSlot = { id: ticket.id, index: 0, x: 0, y: 0 };
    paintTicket(
      ctx,
      slot,
      ticket,
      cardWidth,
      metrics,
      dpr,
      0,
      boxes,
      useSprites,
    );
  }, [ticket, cardWidth, cardHeight, layout, paintGen]);

  return (
    <section className="compare__fullSnap">
      <h2 className="compare__caseTitle">{title}</h2>
      <p className="compare__snapNote">
        sprite paint · {paintGen < 1 ? "warming…" : "ready"}
      </p>
      <div
        ref={wrapRef}
        className="compare__stack"
        style={{ width: cardWidth, height: cardHeight }}
      >
        <canvas
          ref={canvasRef}
          className="compare__canvas"
          style={{
            opacity: showCanvas && paintGen > 0 ? canvasOpacity : 0,
            mixBlendMode: blend,
            transform: `translate(${nudgeX}px, ${nudgeY}px)`,
          }}
        />
      </div>
    </section>
  );
}
