/**
 * Temporary canvas-dom-pixels probe for card edge + separator work.
 * Run `__chromeProbe()` in the console on `/`. Delete with the fix.
 */

import { activeDpr, resolveCellBoxModel } from "../../layout/cellBoxModel";
import { getActiveLayout } from "../../layout/catalogLayout";
import { ticketCellLeft } from "../../layout/ticketCellGeometry";
import { snappedTicketSeparatorTop } from "../../model/ticketPresets";
import type { Ticket } from "../../model/tickets";
import { catalogChromeSpriteForProbe, paintCatalogTicketSvgAll } from "./catalogSvgPaint";

type Px = [number, number, number, number];

const PROBE_TICKET: Ticket = {
  id: "chrome-probe",
  no: "7",
  balls: [3, 14, 22, 31, 40, 55],
  hits: [],
  multipliers: {},
  win: "",
};

const CORNER = 10;

function devicePixelContentBox(el: Element): Promise<{ inline: number; block: number } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: { inline: number; block: number } | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    try {
      const ro = new ResizeObserver((entries) => {
        const box = entries[0]?.devicePixelContentBoxSize?.[0];
        ro.disconnect();
        done(box ? { inline: box.inlineSize, block: box.blockSize } : null);
      });
      ro.observe(el, { box: "device-pixel-content-box" });
    } catch {
      done(null);
    }
    setTimeout(() => done(null), 300);
  });
}

function pixel(data: ImageData, x: number, y: number): Px {
  const i = (y * data.width + x) * 4;
  return [data.data[i]!, data.data[i + 1]!, data.data[i + 2]!, data.data[i + 3]!];
}

function imageDataOf(source: HTMLCanvasElement): ImageData | null {
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    return ctx.getImageData(0, 0, source.width, source.height);
  } catch {
    return null;
  }
}

/** Alpha of the top-left corner square, one row per device y. */
function cornerAlpha(data: ImageData): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < CORNER; y++) {
    const row: number[] = [];
    for (let x = 0; x < CORNER; x++) row.push(pixel(data, x, y)[3]);
    rows.push(row);
  }
  return rows;
}

/** Same square as `cornerAlpha`, as `r,g,b,a` strings. */
function cornerPixels(data: ImageData): string[][] {
  const rows: string[][] = [];
  for (let y = 0; y < CORNER; y++) {
    const row: string[] = [];
    for (let x = 0; x < CORNER; x++) row.push(pixel(data, x, y).join(","));
    rows.push(row);
  }
  return rows;
}

/** Columns around `expectedX` that are not the body colour, as `x:r,g,b,a`. */
function separatorColumns(data: ImageData, y: number, expectedX: number, body: Px): string[] {
  const out: string[] = [];
  for (let x = Math.max(0, expectedX - 3); x <= Math.min(data.width - 1, expectedX + 5); x++) {
    const p = pixel(data, x, y);
    const differs =
      Math.abs(p[0] - body[0]) + Math.abs(p[1] - body[1]) + Math.abs(p[2] - body[2]) > 6 ||
      p[3] !== body[3];
    if (differs) out.push(`${x}:${p.join(",")}`);
  }
  return out;
}

function paintProbeCard(disabled: boolean, dpr: number): HTMLCanvasElement | null {
  const layout = getActiveLayout();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(layout.cardWidth * dpr);
  canvas.height = Math.round(layout.metrics.cardHeight * dpr);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  paintCatalogTicketSvgAll(ctx, { ...PROBE_TICKET, disabled }, 0, 0, layout, dpr);
  return canvas;
}

/** Separator rects as the live DOM overlay lays them out, in card device px. */
function domSeparatorRects(dpr: number): { x: number; width: number }[] {
  const chrome = document.querySelector<SVGGElement>(".ticketCard .ticketCard__svgChrome");
  const card = chrome?.closest<HTMLElement>(".ticketCard");
  if (!card || !chrome) return [];
  const cardRect = card.getBoundingClientRect();
  return [...chrome.querySelectorAll<SVGRectElement>("rect")].map((rect) => {
    const r = rect.getBoundingClientRect();
    return { x: +((r.left - cardRect.left) * dpr).toFixed(2), width: +(r.width * dpr).toFixed(2) };
  });
}

async function chromeProbe(): Promise<unknown> {
  const dpr = activeDpr();
  const layout = getActiveLayout();
  const m = layout.metrics;
  const model = resolveCellBoxModel(layout, dpr);
  const tile = document.querySelector<HTMLCanvasElement>("canvas.ticketCanvasLayer");
  const card = document.querySelector<HTMLElement>(".ticketCard");
  const tileRect = tile?.getBoundingClientRect();
  const overlay = card?.querySelector<SVGSVGElement>(".ticketCard__svgOverlay");
  const overlayRect = overlay?.getBoundingClientRect();

  const sepTopDev = Math.round(snappedTicketSeparatorTop(m, dpr) * dpr);
  const sampleY = sepTopDev + Math.floor((m.separatorHeight * dpr) / 2);
  // Body reference sits at a cell centre, never on a separator column.
  const bodyX = Math.round((model.cells[0]!.x + model.cellW / 2) * dpr);
  const expected = [1, 2, 3, 4, 5].map((i) => ({
    x: Math.round((ticketCellLeft(i, layout.cardWidth, m.separatorWidth, dpr) - m.separatorWidth) * dpr),
    width: Math.round(m.separatorWidth * dpr),
  }));

  const faces: Record<string, unknown> = {};
  for (const disabled of [false, true]) {
    const canvas = paintProbeCard(disabled, dpr);
    const data = canvas && imageDataOf(canvas);
    if (!data) continue;
    const body = pixel(data, bodyX, sampleY);
    faces[disabled ? "disabled" : "normal"] = {
      bodyReference: body.join(","),
      separatorColumns: expected.map((e) => separatorColumns(data, sampleY, e.x, body)),
      tileCornerAlpha: cornerAlpha(data),
      tileCornerPixels: cornerPixels(data),
    };
  }

  const sprite = catalogChromeSpriteForProbe("disabled");
  const spriteData = sprite && imageDataOf(sprite);
  const probe = {
    dpr,
    rawDevicePixelRatio: window.devicePixelRatio,
    zoom: +(window.outerWidth / window.innerWidth).toFixed(4),
    viewport: [window.innerWidth, window.innerHeight],
    rect: tileRect ? { width: tileRect.width, height: tileRect.height } : null,
    devicePixelContentBox: tile ? await devicePixelContentBox(tile) : null,
    canvas: tile ? { width: tile.width, height: tile.height } : null,
    drawingBuffer: tile ? { width: tile.width, height: tile.height } : null,
    overlayRect: overlayRect ? { width: overlayRect.width, height: overlayRect.height } : null,
    targetCanvasPoint: { x: expected[0]!.x, y: sampleY },
    layout: {
      preset: m.id,
      cardWidth: layout.cardWidth,
      cardHeight: m.cardHeight,
      radius: m.radius,
      separatorWidth: m.separatorWidth,
      separatorHeight: m.separatorHeight,
      cellW: model.cellW,
    },
    chromeSprite: sprite
      ? {
          width: sprite.width,
          height: sprite.height,
          expectedWidth: Math.round(layout.cardWidth * dpr),
          expectedHeight: Math.round(m.cardHeight * dpr),
          cornerAlpha: spriteData ? cornerAlpha(spriteData) : null,
          cornerPixels: spriteData ? cornerPixels(spriteData) : null,
        }
      : null,
    separators: { expected, dom: domSeparatorRects(dpr) },
    faces,
  };
  console.log("[chrome-probe]", probe);
  return probe;
}

declare global {
  interface Window {
    __chromeProbe?: () => Promise<unknown>;
  }
}

export function installChromePixelProbe(): void {
  window.__chromeProbe = chromeProbe;
  console.info("[chrome-probe] run __chromeProbe() once the catalog has painted");
}
