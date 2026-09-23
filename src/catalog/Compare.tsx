import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { snapdom } from "@zumer/snapdom";

import {
  badgeSurfaceForTicket,
  getMultiplierBadge,
  getMultiplierBadgeDataUrl,
  getMultiplierLabelPlace,
  onBadgeImagesReady,
  warmMultiplierLabels,
} from "./badgeAtlas";
import { paintTicket } from "./CanvasPool";
import {
  activeDpr,
  applyCellBoxCssVars,
  badgeHostDevice,
  getLiveCellBoxModel,
  resolveCellBoxModel,
  setLiveCellBoxModel,
} from "./cellBoxModel";
import {
  getActiveLayout,
  resolveCatalogLayout,
  setActiveLayout,
} from "./catalogLayout";
import {
  getTicketGeometry,
  resolveLiveCellBoxModel,
  warmCellAtlas,
} from "./cellAtlas";
import {
  getHeaderSpriteDataUrl,
  warmIdGlyphs,
  type GlyphColor,
  type HeaderTextEntry,
} from "./idDigitAtlas";
import { headerSlice, ticketChrome, warmCellBitmaps } from "./cellBitmaps";
import { TicketCard } from "./ticketCardElement";
import { rasterizeTicketSvg } from "./ticketSvgRaster";
import {
  applyTicketCssVars,
  resolvePresetFromViewport,
} from "./ticketPresets";
import {
  MULTIPLIER_VALUES,
  isWinTicket,
  type Ticket,
  type TicketSlot,
} from "./tickets";

/** Fixture A — id only (no hits / win). Varied digit widths. */
function makeIdTicket(): Ticket {
  const no = String(1 + Math.floor(Math.random() * 9999));
  return {
    id: "cmp-id",
    no,
    balls: [7, 14, 21, 28, 35, 42],
    hits: [],
    multipliers: {},
    win: formatWin(25 + Math.floor(Math.random() * 500000)),
  };
}

/** Fixture B — dabs + multiplier + win amount (gold). Different id/amount. */
function makeDabTicket(): Ticket {
  const no = String(1 + Math.floor(Math.random() * 9999));
  const mult = MULTIPLIER_VALUES[Math.floor(Math.random() * MULTIPLIER_VALUES.length)]!;
  return {
    id: "cmp-dab",
    no,
    balls: [3, 11, 19, 27, 44, 58],
    hits: [1, 3, 4],
    multipliers: { 3: mult },
    win: formatWin(25 + Math.floor(Math.random() * 500000)),
  };
}

function formatWin(cents: number): string {
  const amount = (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const cur = (["$", "€", "£"] as const)[Math.floor(Math.random() * 3)]!;
  return `${cur}${amount}`;
}

function buildFixtures(): { label: string; ticket: Ticket }[] {
  const idT = makeIdTicket();
  const dabT = makeDabTicket();
  return [
    { label: `ID only (#${idT.no})`, ticket: idT },
    {
      label: `DAB + ${dabT.multipliers[3]}× + $${dabT.win} (#${dabT.no})`,
      ticket: dabT,
    },
  ];
}

function headerEntries(tickets: readonly Ticket[]): HeaderTextEntry[] {
  const out: HeaderTextEntry[] = [];
  for (const t of tickets) {
    const idColor: GlyphColor = isWinTicket(t) ? "idGold" : "idNormal";
    out.push({ text: t.no, color: idColor });
    if (isWinTicket(t) && t.win) out.push({ text: t.win, color: "win" });
  }
  return out;
}

type StackProps = {
  ticket: Ticket;
  label: string;
  cardWidth: number;
  cardHeight: number;
  canvasOpacity: number;
  blend: "normal" | "difference";
  nudgeX: number;
  nudgeY: number;
  showDom: boolean;
  showCanvas: boolean;
  headerOverlay: boolean;
  badgeOverlay: boolean;
  paintGen: number;
};

function TicketStack({
  ticket,
  label,
  cardWidth,
  cardHeight,
  canvasOpacity,
  blend,
  nudgeX,
  nudgeY,
  showDom,
  showCanvas,
  headerOverlay,
  badgeOverlay,
  paintGen,
}: StackProps) {
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
    card.bind(ticket, 0, 0);
    card.dom.style.visibility = showDom ? "visible" : "hidden";
    card.dom.style.zIndex = "1";
  }, [ticket, showDom, cardWidth, cardHeight, paintGen]);

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c || paintGen < 1) return;
    const dpr = activeDpr();
    const layout = getActiveLayout();
    const { metrics } = layout;
    const geo = getTicketGeometry();
    const live = getLiveCellBoxModel() ?? resolveCellBoxModel(layout, dpr);
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
  }, [ticket, cardWidth, cardHeight, paintGen]);

  // Header / badge sprite overlays on DOM (prove capture before canvas paint).
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || paintGen < 1) return;

    wrap.querySelectorAll("img.compare__spriteOverlay").forEach((el) => el.remove());

    if (headerOverlay) {
      const idColor: GlyphColor = isWinTicket(ticket) ? "idGold" : "idNormal";
      const idUrl = getHeaderSpriteDataUrl(ticket.no, idColor);
      const winUrl =
        isWinTicket(ticket) && ticket.win
          ? getHeaderSpriteDataUrl(ticket.win, "win")
          : null;
      const place = (url: string | null, name: string) => {
        if (!url) return;
        const img = document.createElement("img");
        img.className = "compare__spriteOverlay";
        img.alt = name;
        img.src = url;
        img.style.cssText = [
          "position:absolute",
          "left:0",
          "top:0",
          `width:${cardWidth}px`,
          `height:${getActiveLayout().metrics.headerHeight}px`,
          "opacity:0.55",
          "pointer-events:none",
          "z-index:5",
          "outline:1px solid #e11",
          "image-rendering:pixelated",
        ].join(";");
        wrap.appendChild(img);
      };
      place(winUrl, "win");
      place(idUrl, "id");
    }

    if (badgeOverlay) {
      const multEntry = Object.entries(ticket.multipliers)[0];
      if (multEntry) {
        const [idxStr, mult] = multEntry;
        const idx = Number(idxStr);
        const sprite = getMultiplierBadge(mult, badgeSurfaceForTicket(ticket));
        const url = getMultiplierBadgeDataUrl(
          mult,
          badgeSurfaceForTicket(ticket),
        );
        const geo = getTicketGeometry();
        const dpr = activeDpr();
        const live =
          getLiveCellBoxModel() ??
          resolveCellBoxModel(getActiveLayout(), dpr);
        const box =
          geo && geo.cardWidth === cardWidth
            ? geo.cells[idx]
            : live.cells[idx];
        const place = getMultiplierLabelPlace(mult);
        if (url && box && sprite && place) {
          const host = badgeHostDevice(box, getActiveLayout().metrics.dabSize, dpr);
          const w = sprite.width / dpr;
          const h = sprite.height / dpr;
          const img = document.createElement("img");
          img.className = "compare__spriteOverlay";
          img.alt = `mult-${mult}`;
          img.src = url;
          img.style.cssText = [
            "position:absolute",
            `left:${(host.x + place.dx) / dpr}px`,
            `top:${(host.y + place.dy) / dpr}px`,
            `width:${w}px`,
            `height:${h}px`,
            "opacity:0.55",
            "pointer-events:none",
            "z-index:6",
            "outline:1px solid #0a0",
            "image-rendering:pixelated",
          ].join(";");
          wrap.appendChild(img);
        }
      }
    }
  }, [
    ticket,
    cardWidth,
    headerOverlay,
    badgeOverlay,
    paintGen,
  ]);

  return (
    <section className="compare__case">
      <h2 className="compare__caseTitle">{label}</h2>
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

const SNAP_OPTS = {
  embedFonts: true,
  // Drop the card's translate3d(0,0,0). Leaving it on pads the bitmap by
  // 1px on every side and the card paints low and to the right.
  outerTransforms: true,
  outerShadows: false,
  backgroundColor: "transparent" as const,
  fast: true,
  cache: "disabled" as const,
  compress: false,
  scale: 1,
};

/**
 * SnapDOM's text raster is off native by one device pixel, and the
 * direction depends on the card's font metrics. Measured at dpr 2:
 *   39px card — numbers 1px high, amount/id 1px low, rules 1px down-right.
 *   43px card — numbers seated, amount/id 1px high, rules 1px right.
 * Applied only on the clone that gets snapped. The rotated N× is
 * painted separately, around the label center.
 */
function nudgeSnapText(root: HTMLElement, dpr: number): boolean {
  if (Math.abs(dpr - 2) > 0.01) return false;
  const cardH = parseFloat(
    getComputedStyle(root).getPropertyValue("--ticket-card-height"),
  );
  if (cardH === 39) {
    nudgeNumberText(root, 0.5);
    nudgeHeaderText(root, -0.5);
    root.style.setProperty("--ticket-sep-nudge-x", "-0.5px");
    root.style.setProperty("--ticket-sep-nudge-y", "-0.5px");
    return true;
  }
  if (cardH === 43) {
    nudgeHeaderText(root, 0.5);
    root.style.setProperty("--ticket-sep-nudge-x", "-0.5px");
    return true;
  }
  return false;
}

function nudgeHeaderText(root: HTMLElement, dy: number): void {
  const px = `translateY(${dy}px)`;
  for (const sel of [".ticketCard__win", ".ticketCard__id"]) {
    const el = root.querySelector<HTMLElement>(sel);
    if (el) el.style.transform = px;
  }
}

function nudgeNumberText(root: HTMLElement, dy: number): void {
  for (const cell of root.querySelectorAll(".ticketCard__cell")) {
    const text = [...cell.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    if (!text?.textContent) continue;
    const span = document.createElement("span");
    span.style.display = "inline-block";
    span.style.transform = `translateY(${dy}px)`;
    span.textContent = text.textContent;
    text.replaceWith(span);
  }
}

async function snapCardBox(
  el: HTMLElement,
  dpr: number,
): Promise<HTMLCanvasElement> {
  const shot = await snapdom(el, { ...SNAP_OPTS, dpr });
  const { contentX, contentY, w0, h0 } = shot.meta;
  return shot.toCanvas({
    crop: { x: contentX, y: contentY, width: w0, height: h0 },
  });
}

const MULTIPLIER_ROTATION = (-15 * Math.PI) / 180;

type DeviceBox = { x: number; y: number; w: number; h: number; cx: number; cy: number };

function deviceBox(
  box: DOMRect,
  root: DOMRect,
  bitmapW: number,
  bitmapH: number,
): DeviceBox {
  const sx = bitmapW / root.width;
  const sy = bitmapH / root.height;
  const x = (box.left - root.left) * sx;
  const y = (box.top - root.top) * sy;
  const w = box.width * sx;
  const h = box.height * sy;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

/**
 * SnapDOM rotates around the top-left and drops the centering translation,
 * so a CSS `rotate(-15deg)` does not land on the browser's rotation.
 * The unrotated label matches the DOM exactly. Capture that, rotate it
 * around the label's own center, and paint it where the live label sits.
 */
function paintRotatedMultiplier(
  base: HTMLCanvasElement,
  flat: HTMLCanvasElement,
  flatRoot: HTMLElement,
  liveRoot: HTMLElement,
): HTMLCanvasElement {
  const flatLabel = flatRoot.querySelector<HTMLElement>(".ticketCard__multiplier");
  const liveLabel = liveRoot.querySelector<HTMLElement>(".ticketCard__multiplier");
  if (!flatLabel || !liveLabel) return base;

  const src = deviceBox(
    flatLabel.getBoundingClientRect(),
    flatRoot.getBoundingClientRect(),
    flat.width,
    flat.height,
  );
  const dest = deviceBox(
    liveLabel.getBoundingClientRect(),
    liveRoot.getBoundingClientRect(),
    base.width,
    base.height,
  );
  const fontPx = parseFloat(getComputedStyle(flatLabel).fontSize) || 13;
  const pad = Math.ceil(fontPx * 0.8 * (flat.width / flatRoot.getBoundingClientRect().width));
  const cropX = Math.floor(src.x - pad);
  const cropY = Math.floor(src.y - pad);
  const cropW = Math.ceil(src.w + pad * 2);
  const cropH = Math.ceil(src.h + pad * 2);

  const sprite = document.createElement("canvas");
  sprite.width = cropW;
  sprite.height = cropH;
  const sctx = sprite.getContext("2d");
  const bg = document.createElement("canvas");
  bg.width = cropW;
  bg.height = cropH;
  const bctx = bg.getContext("2d");
  if (!sctx || !bctx) return base;
  sctx.drawImage(flat, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  bctx.drawImage(base, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  const img = sctx.getImageData(0, 0, cropW, cropH);
  const bimg = bctx.getImageData(0, 0, cropW, cropH);
  const data = img.data;
  const bd = bimg.data;
  for (let i = 0; i < data.length; i += 4) {
    const diff = Math.max(
      Math.abs(data[i]! - bd[i]!),
      Math.abs(data[i + 1]! - bd[i + 1]!),
      Math.abs(data[i + 2]! - bd[i + 2]!),
    );
    const alpha = Math.min(1, diff / 70);
    if (alpha < 0.06) {
      data[i + 3] = 0;
    } else {
      data[i] = Math.max(0, Math.min(255, Math.round((data[i]! - bd[i]! * (1 - alpha)) / alpha)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round((data[i + 1]! - bd[i + 1]! * (1 - alpha)) / alpha)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round((data[i + 2]! - bd[i + 2]! * (1 - alpha)) / alpha)));
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  sctx.putImageData(img, 0, 0);

  const out = document.createElement("canvas");
  out.width = base.width;
  out.height = base.height;
  const ctx = out.getContext("2d");
  if (!ctx) return base;
  ctx.drawImage(base, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(dest.cx, dest.cy);
  ctx.rotate(MULTIPLIER_ROTATION);
  ctx.translate(-(src.cx - cropX), -(src.cy - cropY));
  ctx.drawImage(sprite, 0, 0);
  ctx.restore();
  return out;
}

function captureClone(live: HTMLElement): HTMLElement {
  const clone = live.cloneNode(true) as HTMLElement;
  clone.style.position = "fixed";
  clone.style.left = "-10000px";
  clone.style.top = "0";
  clone.style.transform = "none";
  clone.style.visibility = "visible";
  (live.closest(".compare") ?? document.body).appendChild(clone);
  return clone;
}

async function snapFullCard(
  live: HTMLElement,
  dpr: number,
): Promise<{ bitmap: HTMLCanvasElement; nudged: boolean }> {
  const hidden = captureClone(live);
  const flat = captureClone(live);
  const nudged = nudgeSnapText(hidden, dpr);
  nudgeSnapText(flat, dpr);
  const hiddenLabel = hidden.querySelector<HTMLElement>(".ticketCard__multiplier");
  const flatLabel = flat.querySelector<HTMLElement>(".ticketCard__multiplier");
  if (hiddenLabel) hiddenLabel.style.visibility = "hidden";
  if (flatLabel) flatLabel.style.transform = "none";
  try {
    await snapCardBox(hidden, dpr);
    const base = await snapCardBox(hidden, dpr);
    await snapCardBox(flat, dpr);
    const flatBmp = await snapCardBox(flat, dpr);
    return { bitmap: paintRotatedMultiplier(base, flatBmp, flat, live), nudged };
  } finally {
    hidden.remove();
    flat.remove();
  }
}
function FullSnapStack({
  ticket,
  cardWidth,
  cardHeight,
  canvasOpacity,
  blend,
  nudgeX,
  nudgeY,
  showDom,
  showCanvas,
  paintGen,
}: Omit<StackProps, "label" | "headerOverlay" | "badgeOverlay">) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<TicketCard | null>(null);
  const [snapNote, setSnapNote] = useState("waiting for the live card…");

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let card = cardRef.current;
    if (!card) {
      card = new TicketCard();
      cardRef.current = card;
      wrap.appendChild(card.dom);
    }
    card.bind(ticket, 0, 0);
    card.dom.style.visibility = showDom ? "visible" : "hidden";
    card.dom.style.zIndex = "1";
  }, [ticket, showDom, cardWidth, cardHeight, paintGen]);

  useEffect(() => {
    const card = cardRef.current;
    const c = canvasRef.current;
    if (!card || !c || paintGen < 1) return;
    let cancelled = false;
    const dpr = activeDpr();

    void (async () => {
      setSnapNote("snapping the live ticket…");
      const shot = await snapFullCard(card.dom, dpr);
      if (cancelled) return;
      const raw = shot.bitmap;
      const nudged = shot.nudged;

      if (c.width !== raw.width || c.height !== raw.height) {
        c.width = raw.width;
        c.height = raw.height;
      }
      c.style.width = `${cardWidth}px`;
      c.style.height = `${cardHeight}px`;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, raw.width, raw.height);
      ctx.drawImage(raw, 0, 0);
      const wantW = Math.round(cardWidth * dpr);
      const wantH = Math.round(cardHeight * dpr);
      const box =
        raw.width === wantW && raw.height === wantH
          ? `${raw.width}×${raw.height} card box`
          : `snap ${raw.width}×${raw.height}, card ${wantW}×${wantH}`;
      setSnapNote(nudged ? `${box} · text snapped` : box);
    })().catch((err: unknown) => {
      if (!cancelled) {
        setSnapNote(err instanceof Error ? err.message : "snap failed");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [ticket, cardWidth, cardHeight, paintGen]);

  const mult = ticket.multipliers[3] ?? "";
  return (
    <section className="compare__fullSnap">
      <h2 className="compare__caseTitle">
        Full-ticket snap · DAB + {mult}× + {ticket.win} (#{ticket.no})
      </h2>
      <p className="compare__snapNote">{snapNote}</p>
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

/** Same dab ticket, rasterized as a self-contained SVG instead of a DOM clone. */
function SvgRasterStack({
  ticket,
  cardWidth,
  cardHeight,
  canvasOpacity,
  blend,
  nudgeX,
  nudgeY,
  showDom,
  showCanvas,
  paintGen,
}: Omit<StackProps, "label" | "headerOverlay" | "badgeOverlay">) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<TicketCard | null>(null);
  const [note, setNote] = useState("waiting for the live card…");

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let card = cardRef.current;
    if (!card) {
      card = new TicketCard();
      cardRef.current = card;
      wrap.appendChild(card.dom);
    }
    card.bind(ticket, 0, 0);
    card.dom.style.visibility = showDom ? "visible" : "hidden";
    card.dom.style.zIndex = "1";
  }, [ticket, showDom, cardWidth, cardHeight, paintGen]);

  useEffect(() => {
    const card = cardRef.current;
    const c = canvasRef.current;
    if (!card || !c || paintGen < 1) return;
    let cancelled = false;
    const dpr = activeDpr();
    void (async () => {
      setNote("rasterizing SVG…");
      const raw = await rasterizeTicketSvg(card.dom, dpr);
      if (cancelled) return;
      if (c.width !== raw.width || c.height !== raw.height) {
        c.width = raw.width;
        c.height = raw.height;
      }
      c.style.width = `${cardWidth}px`;
      c.style.height = `${cardHeight}px`;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, raw.width, raw.height);
      ctx.drawImage(raw, 0, 0);
      setNote(`${raw.width}×${raw.height} svg raster`);
    })().catch((err: unknown) => {
      if (!cancelled) setNote(err instanceof Error ? err.message : "svg failed");
    });
    return () => {
      cancelled = true;
    };
  }, [ticket, cardWidth, cardHeight, paintGen]);

  const mult = ticket.multipliers[3] ?? "";
  return (
    <section className="compare__fullSnap">
      <h2 className="compare__caseTitle">
        SVG raster · DAB + {mult}× + {ticket.win} (#{ticket.no})
      </h2>
      <p className="compare__snapNote">{note}</p>
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

/**
 * One baked bitmap per ball number, one dab, and one bitmap per multiplier.
 * Each was captured from a real cell, so it is drawn at that cell's origin.
 * Header amount and ticket id are not in this set.
 */
function CellBitmapStack({
  ticket,
  cardWidth,
  cardHeight,
  canvasOpacity,
  blend,
  nudgeX,
  nudgeY,
  showDom,
  showCanvas,
  paintGen,
}: Omit<StackProps, "label" | "headerOverlay" | "badgeOverlay">) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const plainRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<TicketCard | null>(null);
  const [note, setNote] = useState("capturing 60 numbers, dab, and multipliers…");

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let card = cardRef.current;
    if (!card) {
      card = new TicketCard();
      cardRef.current = card;
      wrap.appendChild(card.dom);
    }
    card.bind(ticket, 0, 0);
    card.dom.style.visibility = showDom ? "visible" : "hidden";
    card.dom.style.zIndex = "1";
  }, [ticket, showDom, cardWidth, cardHeight, paintGen]);

  useEffect(() => {
    const card = cardRef.current;
    const overlay = canvasRef.current;
    const plain = plainRef.current;
    const host = document.querySelector(".catalog__captureHost");
    if (!card || !overlay || !plain || !host || paintGen < 1) return;
    let cancelled = false;
    const dpr = activeDpr();
    void (async () => {
      setNote("capturing 60 numbers, dab, and multipliers…");
      const set = await warmCellBitmaps(host as HTMLElement);
      if (cancelled) return;
      const win = isWinTicket(ticket);
      const chrome = await ticketChrome(host as HTMLElement, win);
      const winEl = card.dom.querySelector(".ticketCard__win") as HTMLElement | null;
      const idEl = card.dom.querySelector(".ticketCard__id") as HTMLElement | null;
      const winText = winEl?.textContent ?? "";
      const idText = idEl?.textContent ?? "";
      const winBmp = winEl && winText ? await headerSlice(winEl, `win|${winText}`) : null;
      const idBmp = idEl && idText ? await headerSlice(idEl, `id|${idText}|${win ? "gold" : "plain"}`) : null;
      if (cancelled) return;
      const origin = card.dom.getBoundingClientRect();
      const sliceAt = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return {
          x: Math.round((r.x - origin.x) * dpr),
          y: Math.round((r.y - origin.y) * dpr),
        };
      };
      const winAt = winEl && winBmp ? sliceAt(winEl) : null;
      const idAt = idEl && idBmp ? sliceAt(idEl) : null;
      const model = getLiveCellBoxModel() ?? resolveCellBoxModel(getActiveLayout(), dpr);
      const bw = Math.round(cardWidth * dpr);
      const bh = Math.round(cardHeight * dpr);
      const paint = (c: HTMLCanvasElement) => {
        if (c.width !== bw || c.height !== bh) {
          c.width = bw;
          c.height = bh;
        }
        c.style.width = `${cardWidth}px`;
        c.style.height = `${cardHeight}px`;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, bw, bh);
        ctx.drawImage(chrome, 0, 0);
        if (winBmp && winAt) ctx.drawImage(winBmp, winAt.x, winAt.y);
        if (idBmp && idAt) ctx.drawImage(idBmp, idAt.x, idAt.y);
        for (let i = 0; i < ticket.balls.length; i++) {
          const cell = model.cells[i];
          if (!cell) continue;
          const x = Math.round(cell.x * dpr);
          const y = Math.round(cell.y * dpr);
          const mult = ticket.multipliers[i] ?? 0;
          const badge = badgeHostDevice(cell, getActiveLayout().metrics.dabSize, dpr);
          const padX = (padCss: number) => badge.x - Math.round(padCss * dpr);
          const padY = (padCss: number) => badge.y - Math.round(padCss * dpr);
          if (mult > 0) {
            const bmp = set.multipliers.get(mult);
            if (bmp) ctx.drawImage(bmp.canvas, padX(bmp.padCss), padY(bmp.padCss));
            continue;
          }
          const number = set.numbers[ticket.balls[i] ?? 0];
          if (number) ctx.drawImage(number, x, y);
          if (ticket.hits.includes(i)) {
            ctx.drawImage(set.dab.canvas, padX(set.dab.padCss), padY(set.dab.padCss));
          }
        }
      };
      paint(overlay);
      paint(plain);
      setNote("gold, separators, amount, id, numbers, dab, multipliers");
    })().catch((err: unknown) => {
      if (!cancelled) setNote(err instanceof Error ? err.message : "capture failed");
    });
    return () => {
      cancelled = true;
    };
  }, [ticket, cardWidth, cardHeight, paintGen]);

  const mult = ticket.multipliers[3] ?? "";
  return (
    <section className="compare__fullSnap">
      <h2 className="compare__caseTitle">
        Cell bitmaps · DAB + {mult}× + {ticket.win} (#{ticket.no})
      </h2>
      <p className="compare__snapNote">{note}</p>
      <div className="compare__cellRow">
        <div>
          <p className="compare__snapNote">overlay</p>
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
        </div>
        <div>
          <p className="compare__snapNote">canvas</p>
          <div
            className="compare__stack"
            style={{ width: cardWidth, height: cardHeight }}
          >
            <canvas
              ref={plainRef}
              className="compare__canvas compare__canvas_plain"
              style={{ opacity: paintGen > 0 ? 1 : 0 }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export function Compare() {
  const cssHostRef = useRef<HTMLDivElement>(null);
  const atlasHostRef = useRef<HTMLDivElement>(null);
  const badgeHostRef = useRef<HTMLDivElement>(null);
  const idHostRef = useRef<HTMLDivElement>(null);

  const [fixtures, setFixtures] = useState(buildFixtures);
  const [paintGen, setPaintGen] = useState(0);
  const [status, setStatus] = useState("warming…");
  const [canvasOpacity, setCanvasOpacity] = useState(0.55);
  const [blend, setBlend] = useState<"normal" | "difference">("difference");
  const [nudgeX, setNudgeX] = useState(0);
  const [nudgeY, setNudgeY] = useState(0);
  const [showDom, setShowDom] = useState(true);
  const [showCanvas, setShowCanvas] = useState(true);
  const [headerOverlay, setHeaderOverlay] = useState(false);
  const [badgeOverlay, setBadgeOverlay] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));

  const metrics = resolvePresetFromViewport(viewport.w, viewport.h);
  const isMobile = metrics.id.startsWith("mobile");
  const isLandscape = viewport.w > viewport.h;
  const layout = useMemo(
    () => resolveCatalogLayout(isMobile, isLandscape, 400, metrics),
    [isMobile, isLandscape, metrics],
  );

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
    const onResize = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const atlasHost = atlasHostRef.current;
    const badgeHost = badgeHostRef.current;
    const idHost = idHostRef.current;
    if (!atlasHost || !badgeHost || !idHost) return;
    let cancelled = false;

    applyTicketCssVars(atlasHost, getActiveLayout().metrics);

    void (async () => {
      setStatus("warming cell atlas…");
      const src = await warmCellAtlas(atlasHost);
      if (cancelled || src === "empty") return;

      setStatus("warming multiplier cells…");
      await new Promise<void>((resolve) => onBadgeImagesReady(resolve));
      await warmMultiplierLabels(badgeHost, MULTIPLIER_VALUES);
      if (cancelled) return;

      setStatus("warming header sprites…");
      const tickets = fixtures.map((f) => f.ticket);
      await warmIdGlyphs(idHost, getActiveLayout(), headerEntries(tickets));
      if (cancelled) return;

      setPaintGen((g) => g + 1);
      setStatus("ready — overlay canvas on DOM");
    })();

    return () => {
      cancelled = true;
    };
    // fixtures intentionally omitted — reshuffle handles header re-warm
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  const reshuffle = () => {
    const next = buildFixtures();
    setFixtures(next);
    const idHost = idHostRef.current;
    if (!idHost) {
      setPaintGen((g) => g + 1);
      return;
    }
    setStatus("warming new header strings…");
    void warmIdGlyphs(
      idHost,
      getActiveLayout(),
      headerEntries(next.map((f) => f.ticket)),
    ).then(() => {
      setPaintGen((g) => g + 1);
      setStatus("ready — overlay canvas on DOM");
    });
  };

  const downloadSprites = () => {
    const a = document.createElement("a");
    const save = (url: string | null | undefined, name: string) => {
      if (!url) return;
      a.href = url;
      a.download = name;
      a.click();
    };
    for (const { ticket } of fixtures) {
      const idColor: GlyphColor = isWinTicket(ticket) ? "idGold" : "idNormal";
      save(getHeaderSpriteDataUrl(ticket.no, idColor), `id-${ticket.no}.png`);
      if (isWinTicket(ticket) && ticket.win) {
        save(getHeaderSpriteDataUrl(ticket.win, "win"), `win-${ticket.win}.png`);
      }
      for (const mult of Object.values(ticket.multipliers)) {
        save(getMultiplierBadgeDataUrl(mult), `badge-${mult}x.png`);
        save(
          getMultiplierBadgeDataUrl(mult, "gold"),
          `badge-${mult}x-gold.png`,
        );
        save(
          getMultiplierBadgeDataUrl(mult, "disabled"),
          `badge-${mult}x-disabled.png`,
        );
      }
    }
  };

  return (
    <div className="compare" ref={cssHostRef}>
      <header className="compare__toolbar">
        <div className="compare__nav">
          <a href="/">← catalog</a>
          <strong>DOM ↔ Canvas compare</strong>
          <span className="compare__status">{status}</span>
          <button type="button" className="btn-ghost" onClick={reshuffle}>
            Reshuffle IDs / amounts
          </button>
          <button type="button" className="btn-ghost" onClick={downloadSprites}>
            Download sprites
          </button>
        </div>
        <div className="compare__controls">
          <label>
            canvas α
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
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
            nudge X
            <input
              type="number"
              step={0.25}
              value={nudgeX}
              onChange={(e) => setNudgeX(Number(e.target.value))}
            />
          </label>
          <label>
            nudge Y
            <input
              type="number"
              step={0.25}
              value={nudgeY}
              onChange={(e) => setNudgeY(Number(e.target.value))}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={showDom}
              onChange={(e) => setShowDom(e.target.checked)}
            />
            DOM
          </label>
          <label>
            <input
              type="checkbox"
              checked={showCanvas}
              onChange={(e) => setShowCanvas(e.target.checked)}
            />
            Canvas
          </label>
          <label>
            <input
              type="checkbox"
              checked={headerOverlay}
              onChange={(e) => setHeaderOverlay(e.target.checked)}
            />
            header sprite on DOM
          </label>
          <label>
            <input
              type="checkbox"
              checked={badgeOverlay}
              onChange={(e) => setBadgeOverlay(e.target.checked)}
            />
            badge sprite on DOM
          </label>
        </div>
        <p className="compare__hint">
          Multiplier disc and dab share one device-pixel box. The N× label is
          a SnapDOM sprite shifted onto the live label. Difference blend
          should go dark where they match. The bottom row blits 60 number
          cells, one dab, and multipliers 2, 3, 5, and 10. Amount and ticket
          id are not in that set.
        </p>
      </header>

      <div className="compare__cases">
        {fixtures.map(({ label, ticket }) => (
          <TicketStack
            key={`${ticket.id}-${ticket.no}-${ticket.win}-${ticket.multipliers[3] ?? 0}`}
            label={label}
            ticket={ticket}
            cardWidth={layout.cardWidth}
            cardHeight={layout.cardHeight}
            canvasOpacity={canvasOpacity}
            blend={blend}
            nudgeX={nudgeX}
            nudgeY={nudgeY}
            showDom={showDom}
            showCanvas={showCanvas}
            headerOverlay={headerOverlay}
            badgeOverlay={badgeOverlay}
            paintGen={paintGen}
          />
        ))}
      </div>

      {fixtures
        .filter((f) => f.ticket.id === "cmp-dab")
        .map(({ ticket }) => (
          <Fragment key={`rows-${ticket.no}-${ticket.win}`}>
          <FullSnapStack
            key={`snap-${ticket.no}-${ticket.win}-${ticket.multipliers[3] ?? 0}`}
            ticket={ticket}
            cardWidth={layout.cardWidth}
            cardHeight={layout.cardHeight}
            canvasOpacity={canvasOpacity}
            blend={blend}
            nudgeX={nudgeX}
            nudgeY={nudgeY}
            showDom={showDom}
            showCanvas={showCanvas}
            paintGen={paintGen}
          />
          <SvgRasterStack
            key={`svg-${ticket.no}-${ticket.win}-${ticket.multipliers[3] ?? 0}`}
            ticket={ticket}
            cardWidth={layout.cardWidth}
            cardHeight={layout.cardHeight}
            canvasOpacity={canvasOpacity}
            blend={blend}
            nudgeX={nudgeX}
            nudgeY={nudgeY}
            showDom={showDom}
            showCanvas={showCanvas}
            paintGen={paintGen}
          />
          <CellBitmapStack
            key={`cells-${ticket.no}-${ticket.win}-${ticket.multipliers[3] ?? 0}`}
            ticket={ticket}
            cardWidth={layout.cardWidth}
            cardHeight={layout.cardHeight}
            canvasOpacity={canvasOpacity}
            blend={blend}
            nudgeX={nudgeX}
            nudgeY={nudgeY}
            showDom={showDom}
            showCanvas={showCanvas}
            paintGen={paintGen}
          />
          </Fragment>
        ))}

      <div ref={atlasHostRef} className="catalog__captureHost" />
      <div ref={badgeHostRef} className="catalog__captureHost" />
      <div ref={idHostRef} className="catalog__captureHost" />
    </div>
  );
}
