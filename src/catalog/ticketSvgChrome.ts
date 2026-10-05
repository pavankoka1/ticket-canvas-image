/**
 * Ticket chrome as SVG primitives (Figma Ticket Desktop 6177:126669).
 * Painted inside the svg-all overlay on catalog home.
 */

import { svgEl } from "./compareSvgMultiplier";
import type { TicketMetrics } from "./ticketPresets";

export const SVG_CHROME_CLASS = "ticketCard__svgChrome";

type Face = "normal" | "gold" | "disabled";

const PALETTE = {
  normal: {
    header: "#f8eadb",
    bodyTop: "#ffffff",
    bodyBottom: "#f3eae0",
    separator: "rgba(177, 151, 151, 0.5)",
  },
  gold: {
    shell: "#ffd65c",
    headerTop: "#ffefa5",
    headerBottom: "#ffd65c",
    bodyTop: "#ffe96e",
    bodyMid: "#ffd054",
    bodyBottom: "#f98900",
    separator: "#cb9330",
  },
  disabled: {
    shell: "#0d5b58",
    header: "#0a4845",
    body: "#0d5b58",
    separator: "#0a4744",
  },
} as const;

function sepX(cellIndex: number, cellW: number, sep: number): number {
  return cellIndex * (cellW + sep) - sep;
}

/** Chrome + separators behind overlay text (card CSS px). `idSuffix` avoids duplicate gradient/filter ids across tickets. */
export function buildTicketChromeSvg(
  cardWidth: number,
  metrics: TicketMetrics,
  face: Face,
  cellW: number,
  idSuffix: string,
): SVGElement[] {
  const r = metrics.radius;
  const headerH = metrics.headerHeight;
  const bodyH = metrics.bodyHeight;
  const padY = metrics.bodyPaddingY;
  const sepH = metrics.separatorHeight;
  const sepTop = metrics.separatorMarginTop;
  const sep = metrics.separatorWidth;
  const suf = idSuffix.replace(/[^a-zA-Z0-9_-]/g, "") || "0";
  const shadowId = `cmpTicketShadow-${suf}`;
  const parts: SVGElement[] = [];

  const shadow = svgEl(
    "filter",
    { id: shadowId, x: "-20%", y: "-20%", width: "140%", height: "140%" },
    svgEl("feDropShadow", {
      dx: 0,
      dy: 2,
      stdDeviation: 0.5,
      "flood-color": "#000000",
      "flood-opacity": 0.42,
    }),
  );
  parts.push(shadow);
  parts.push(
    svgEl("rect", {
      x: 0,
      y: 0,
      width: cardWidth,
      height: metrics.cardHeight,
      rx: r,
      ry: r,
      fill:
        face === "normal"
          ? PALETTE.normal.header
          : face === "gold"
            ? PALETTE.gold.shell
            : PALETTE.disabled.shell,
      filter: `url(#${shadowId})`,
    }),
  );

  if (face === "gold") {
    const headerGradId = `cmpTicketHeaderGold-${suf}`;
    parts.push(
      svgEl(
        "linearGradient",
        { id: headerGradId, x1: 0, y1: 0, x2: 0, y2: 1 },
        svgEl("stop", { offset: "0%", "stop-color": PALETTE.gold.headerTop }),
        svgEl("stop", { offset: "100%", "stop-color": PALETTE.gold.headerBottom }),
      ),
    );
    parts.push(
      svgEl("rect", {
        x: 0,
        y: 0,
        width: cardWidth,
        height: headerH,
        rx: r,
        ry: r,
        fill: `url(#${headerGradId})`,
      }),
    );
  } else {
    parts.push(
      svgEl("rect", {
        x: 0,
        y: 0,
        width: cardWidth,
        height: headerH,
        rx: r,
        ry: r,
        fill: face === "normal" ? PALETTE.normal.header : PALETTE.disabled.header,
      }),
    );
  }

  if (face === "normal") {
    const bodyGradId = `cmpTicketBodyNormal-${suf}`;
    const grad = svgEl(
      "linearGradient",
      { id: bodyGradId, x1: 0, y1: 0, x2: 0, y2: 1 },
      svgEl("stop", { offset: "0%", "stop-color": PALETTE.normal.bodyTop }),
      svgEl("stop", { offset: "100%", "stop-color": PALETTE.normal.bodyBottom }),
    );
    parts.push(grad);
    parts.push(
      svgEl("rect", {
        x: 0,
        y: headerH,
        width: cardWidth,
        height: bodyH,
        rx: r,
        ry: r,
        fill: `url(#${bodyGradId})`,
      }),
    );
  } else if (face === "gold") {
    const bodyGradId = `cmpTicketBodyGold-${suf}`;
    parts.push(
      svgEl(
        "linearGradient",
        { id: bodyGradId, x1: 0, y1: 0, x2: 0, y2: 1 },
        svgEl("stop", { offset: "0%", "stop-color": PALETTE.gold.bodyTop }),
        svgEl("stop", { offset: "50%", "stop-color": PALETTE.gold.bodyMid }),
        svgEl("stop", { offset: "100%", "stop-color": PALETTE.gold.bodyBottom }),
      ),
    );
    parts.push(
      svgEl("rect", {
        x: 0,
        y: headerH,
        width: cardWidth,
        height: bodyH,
        rx: r,
        ry: r,
        fill: `url(#${bodyGradId})`,
      }),
    );
  } else {
    parts.push(
      svgEl("rect", {
        x: 0,
        y: headerH,
        width: cardWidth,
        height: bodyH,
        rx: r,
        ry: r,
        fill: PALETTE.disabled.body,
      }),
    );
  }

  const separator =
    face === "gold" ? PALETTE.gold.separator : face === "disabled" ? PALETTE.disabled.separator : PALETTE.normal.separator;
  for (let i = 1; i < 6; i++) {
    parts.push(
      svgEl("rect", {
        x: sepX(i, cellW, sep),
        y: headerH + padY + sepTop,
        width: sep,
        height: sepH,
        rx: 2,
        ry: 2,
        fill: separator,
      }),
    );
  }

  return [svgEl("g", { class: SVG_CHROME_CLASS }, ...parts)];
}
