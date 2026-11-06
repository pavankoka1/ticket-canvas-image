/**
 * Ticket chrome as SVG primitives (Figma Ticket Desktop 6177:126669).
 * Painted inside the svg-all overlay on catalog home.
 */

import type { CatalogLayout } from '../layout/catalogLayout';
import { resolveCellBoxModel, ticketCssToBuffer } from '../layout/cellBoxModel';
import { ticketCellLeft } from '../layout/ticketCellGeometry';
import { parseTicketShadow, snappedTicketSeparatorTop, type TicketMetrics } from '../model/ticketPresets';
import type { TicketFace } from '../model/tickets';
import { svgEl } from '../../catalog/compareSvgMultiplier';

export const SVG_CHROME_CLASS = 'ticketCard__svgChrome';

type Face = TicketFace;

const PALETTE = {
  normal: {
    header: '#f8eadb',
    bodyTop: '#ffffff',
    bodyBottom: '#f3eae0',
    separator: 'rgba(177, 151, 151, 0.5)',
  },
  gold: {
    shell: '#ffd65c',
    headerTop: '#ffefa5',
    headerBottom: '#ffd65c',
    bodyTop: '#ffe96e',
    bodyMid: '#ffd054',
    bodyBottom: '#f98900',
    separator: '#cb9330',
  },
  disabled: {
    shell: '#0d5b58',
    header: '#0a4845',
    body: '#0d5b58',
    separator: '#0a4744',
  },
} as const;

function separatorFill(face: Face): string {
  return PALETTE[face].separator;
}

/** Header band: top corners only (matches `.ticketCard__header` CSS). */
function headerBandPath(cardWidth: number, headerH: number, r: number): string {
  const w = cardWidth;
  const h = headerH;
  const cr = Math.min(r, w / 2, h);
  if (cr <= 0) return `M 0 0 H ${w} V ${h} H 0 Z`;
  return `M ${cr} 0 H ${w - cr} A ${cr} ${cr} 0 0 1 ${w} ${cr} V ${h} H 0 V ${cr} A ${cr} ${cr} 0 0 1 ${cr} 0 Z`;
}

/** Body band: bottom corners only (matches `.ticketCard__body` CSS). */
function bodyBandPath(cardWidth: number, headerH: number, bodyH: number, r: number): string {
  const w = cardWidth;
  const y0 = headerH;
  const h = bodyH;
  const cr = Math.min(r, w / 2, h);
  if (cr <= 0) return `M 0 ${y0} H ${w} V ${y0 + h} H 0 Z`;
  const y1 = y0 + h;
  return `M 0 ${y0} H ${w} V ${y1 - cr} A ${cr} ${cr} 0 0 1 ${w - cr} ${y1} H ${cr} A ${cr} ${cr} 0 0 1 0 ${y1 - cr} V ${y0} Z`;
}

/** Full card round-rect — opaque shell under header/body (FO raster + svg-face DOM gaps). */
function cardShellPath(cardWidth: number, cardHeight: number, r: number): string {
  const w = cardWidth;
  const h = cardHeight;
  const cr = Math.min(r, w / 2, h);
  if (cr <= 0) return `M 0 0 H ${w} V ${h} H 0 Z`;
  return `M ${cr} 0 H ${w - cr} A ${cr} ${cr} 0 0 1 ${w} ${cr} V ${h - cr} A ${cr} ${cr} 0 0 1 ${w - cr} ${h} H ${cr} A ${cr} ${cr} 0 0 1 0 ${h - cr} V ${cr} A ${cr} ${cr} 0 0 1 ${cr} 0 Z`;
}

function shellFill(face: Face): string | null {
  if (face === 'disabled') return PALETTE.disabled.shell;
  if (face === 'gold') return PALETTE.gold.shell;
  return null;
}

export type TicketChromeFace = Face;

/** Column separators at paint time — same x as `cell[i].x + cellW` (matches ink clip). */
export function paintTicketSeparatorsDevice(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  layout: CatalogLayout,
  metrics: TicketMetrics,
  face: TicketChromeFace,
  dpr: number
): void {
  const model = resolveCellBoxModel(layout, dpr);
  const y = snappedTicketSeparatorTop(metrics, dpr);
  const h = metrics.separatorHeight;
  const sepDev = Math.max(1, ticketCssToBuffer(metrics.separatorWidth, dpr));
  const ht = Math.max(1, ticketCssToBuffer(h, dpr));
  const y0 = originY + ticketCssToBuffer(y, dpr);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = separatorFill(face);
  for (let i = 0; i < 5; i++) {
    const xCss = model.cells[i]!.x + model.cellW;
    const x = originX + ticketCssToBuffer(xCss, dpr);
    ctx.fillRect(x, y0, sepDev, ht);
  }
  ctx.restore();
}

/** Five column separators: `.ticketCard__cell:not(:first-child)::before` (card CSS px). */
export function buildTicketSeparatorSvg(
  metrics: TicketMetrics,
  cardWidth: number,
  face: Face,
  dpr: number
): SVGElement[] {
  const sep = metrics.separatorWidth;
  const y = snappedTicketSeparatorTop(metrics, dpr);
  const fill = separatorFill(face);
  const parts: SVGElement[] = [];
  for (let i = 1; i < 6; i++) {
    parts.push(
      svgEl('rect', {
        x: ticketCellLeft(i, cardWidth, sep, dpr) - sep,
        y,
        width: sep,
        height: metrics.separatorHeight,
        rx: 1,
        ry: 1,
        fill,
        'shape-rendering': 'crispEdges',
      })
    );
  }
  return parts;
}

/** Chrome + separators behind overlay text (card CSS px). `idSuffix` avoids duplicate gradient/filter ids across tickets. */
export function buildTicketChromeSvg(
  cardWidth: number,
  metrics: TicketMetrics,
  face: Face,
  idSuffix: string,
  dpr: number
): SVGElement[] {
  const r = metrics.radius;
  const headerH = metrics.headerHeight;
  const bodyH = metrics.bodyHeight;
  const suf = idSuffix.replace(/[^a-zA-Z0-9_-]/g, '') || '0';
  const shadowId = `cmpTicketShadow-${suf}`;
  const parts: SVGElement[] = [];

  // `.ticketCard_disabled { box-shadow: none }`; desktop presets have no shadow either.
  const shadow = face === 'disabled' ? null : parseTicketShadow(metrics.cardShadow);
  if (shadow) {
    parts.push(
      svgEl(
        'filter',
        { id: shadowId, x: '-20%', y: '-20%', width: '140%', height: '140%' },
        svgEl('feDropShadow', {
          dx: 0,
          dy: shadow.dy,
          stdDeviation: shadow.stdDeviation,
          'flood-color': '#000000',
          'flood-opacity': shadow.opacity,
        })
      )
    );
  }

  const chromeInk: SVGElement[] = [];

  const shell = shellFill(face);
  if (shell) {
    chromeInk.push(
      svgEl('path', {
        d: cardShellPath(cardWidth, metrics.cardHeight, r),
        fill: shell,
      })
    );
  }

  if (face === 'gold') {
    const headerGradId = `cmpTicketHeaderGold-${suf}`;
    parts.push(
      svgEl(
        'linearGradient',
        { id: headerGradId, x1: 0, y1: 0, x2: 0, y2: 1 },
        svgEl('stop', { offset: '0%', 'stop-color': PALETTE.gold.headerTop }),
        svgEl('stop', { offset: '100%', 'stop-color': PALETTE.gold.headerBottom })
      )
    );
    chromeInk.push(
      svgEl('path', {
        d: headerBandPath(cardWidth, headerH, r),
        fill: `url(#${headerGradId})`,
      })
    );
  } else {
    chromeInk.push(
      svgEl('path', {
        d: headerBandPath(cardWidth, headerH, r),
        fill: face === 'normal' ? PALETTE.normal.header : PALETTE.disabled.header,
      })
    );
  }

  if (face === 'normal') {
    const bodyGradId = `cmpTicketBodyNormal-${suf}`;
    const grad = svgEl(
      'linearGradient',
      { id: bodyGradId, x1: 0, y1: 0, x2: 0, y2: 1 },
      svgEl('stop', { offset: '0%', 'stop-color': PALETTE.normal.bodyTop }),
      svgEl('stop', { offset: '100%', 'stop-color': PALETTE.normal.bodyBottom })
    );
    parts.push(grad);
    chromeInk.push(
      svgEl('path', {
        d: bodyBandPath(cardWidth, headerH, bodyH, r),
        fill: `url(#${bodyGradId})`,
      })
    );
  } else if (face === 'gold') {
    const bodyGradId = `cmpTicketBodyGold-${suf}`;
    parts.push(
      svgEl(
        'linearGradient',
        { id: bodyGradId, x1: 0, y1: 0, x2: 0, y2: 1 },
        svgEl('stop', { offset: '0%', 'stop-color': PALETTE.gold.bodyTop }),
        svgEl('stop', { offset: '50%', 'stop-color': PALETTE.gold.bodyMid }),
        svgEl('stop', { offset: '100%', 'stop-color': PALETTE.gold.bodyBottom })
      )
    );
    chromeInk.push(
      svgEl('path', {
        d: bodyBandPath(cardWidth, headerH, bodyH, r),
        fill: `url(#${bodyGradId})`,
      })
    );
  } else {
    chromeInk.push(
      svgEl('path', {
        d: bodyBandPath(cardWidth, headerH, bodyH, r),
        fill: PALETTE.disabled.body,
      })
    );
  }

  parts.push(svgEl('g', shadow ? { filter: `url(#${shadowId})` } : {}, ...chromeInk));
  parts.push(...buildTicketSeparatorSvg(metrics, cardWidth, face, dpr));

  return [svgEl('g', { class: SVG_CHROME_CLASS }, ...parts)];
}
