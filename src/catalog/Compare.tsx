import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  badgeSurfaceForTicket,
  getMultiplierBadge,
  getMultiplierBadgeDataUrl,
  onBadgeImagesReady,
  shellGeometry,
  warmMultiplierLabels,
} from "./badgeAtlas";
import { paintTicket } from "./CanvasPool";
import {
  activeDpr,
  applyCellBoxCssVars,
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
import { TicketCard } from "./ticketCardElement";
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
        if (url && box && sprite) {
          // Shell at cell.x, cell.y − padY (header↔body separator).
          const { padY } = shellGeometry(dpr);
          const w = sprite.width / dpr;
          const h = sprite.height / dpr;
          const img = document.createElement("img");
          img.className = "compare__spriteOverlay";
          img.alt = `mult-${mult}`;
          img.src = url;
          img.style.cssText = [
            "position:absolute",
            `left:${box.x}px`,
            `top:${box.y - padY}px`,
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
    const save = (url: string | null, name: string) => {
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
          Multiplier = full badge SnapDOM on normal / gold / disabled body bg
          (shell [padY|cell+badge|padY]). Blit as captured — no ink-shift.
          (outerTransforms), blit at cell.y − padY (b35).
          / download to inspect.
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

      <div ref={atlasHostRef} className="catalog__captureHost" />
      <div ref={badgeHostRef} className="catalog__captureHost" />
      <div ref={idHostRef} className="catalog__captureHost" />
    </div>
  );
}
