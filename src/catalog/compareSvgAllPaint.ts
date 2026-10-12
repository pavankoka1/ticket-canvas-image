/**
 * Shared svg-all canvas composite (compare optimized + catalog tiles).
 * Matches assembleWithOverlay in compareCachedSprites at v52: chrome, padded
 * badge-body sprites at headerHeight, number patches, then header glyphs.
 */

import { badgeHostDevice, type CellBox } from "../ticketCatalog/cellBoxModel";
import type { CatalogLayout } from "../ticketCatalog/catalogLayout";
import { ensureTicketFontsForLayout } from "../ticketCatalog/ticketFont";
import { applyTicketCssVars } from "../ticketCatalog/ticketPresets";
import { rasterizeTicketSvg } from "../ticketCatalog/ticketSvgRaster";
import { MULTIPLIER_VALUES, ticketCellMultiplier, type Ticket } from "../ticketCatalog/tickets";
import type { ComparePaintPack } from "./compareCachedSprites";
import {
  dabDataUrl,
  discDataUrl,
  loadSvgMultiplierAssets,
  multiplierHostSvg,
} from "./compareSvgMultiplier";

type MultHostSprite = { bitmap: HTMLCanvasElement };

const multHostCache = new Map<string, MultHostSprite>();
let multHostWarmKey = "";

const hostDiscBitmaps = new Map<boolean, HTMLCanvasElement>();
const hostDabBitmaps = new Map<boolean, HTMLCanvasElement>();
let hostBadgeWarmKey = "";

async function pngDataUrlToDeviceSquare(
  dataUrl: string,
  sizeDev: number,
): Promise<HTMLCanvasElement> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("badge PNG load failed"));
    img.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = sizeDev;
  canvas.height = sizeDev;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("badge bitmap 2D context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, sizeDev, sizeDev);
  return canvas;
}

/** Same disc/dab PNGs as svg-all DOM overlay (`discDataUrl` / `dabDataUrl`). */
export async function warmSvgAllHostBadgeBitmaps(
  layout: CatalogLayout,
  dpr: number,
): Promise<void> {
  const key = `${layout.metrics.id}|${layout.cardWidth}|${dpr}`;
  if (hostBadgeWarmKey === key && hostDiscBitmaps.size === 2) return;
  await loadSvgMultiplierAssets();
  const sizeDev = Math.max(1, Math.round(layout.metrics.dabSize * dpr));
  const nextDisc = new Map<boolean, HTMLCanvasElement>();
  const nextDab = new Map<boolean, HTMLCanvasElement>();
  for (const disabled of [false, true]) {
    const discUrl = discDataUrl(disabled);
    const dabUrl = dabDataUrl(disabled);
    if (!discUrl || !dabUrl) return;
    nextDisc.set(disabled, await pngDataUrlToDeviceSquare(discUrl, sizeDev));
    nextDab.set(disabled, await pngDataUrlToDeviceSquare(dabUrl, sizeDev));
  }
  hostBadgeWarmKey = key;
  hostDiscBitmaps.clear();
  hostDabBitmaps.clear();
  for (const [k, v] of nextDisc) hostDiscBitmaps.set(k, v);
  for (const [k, v] of nextDab) hostDabBitmaps.set(k, v);
}

export function isCatalogSvgAllHostInkReady(): boolean {
  return hostDabBitmaps.size === 2 && multHostCache.size > 0;
}

/**
 * Catalog canvas: disc + multiplier ink in one bitmap (same recipe as DOM overlay).
 * Compare’s optimized path bakes this via body-band capture; `/` cannot rasterize per ticket.
 */
export async function warmSvgAllMultiplierHosts(
  layout: CatalogLayout,
  dpr: number,
): Promise<void> {
  const key = `${layout.metrics.id}|${layout.cardWidth}|${dpr}`;
  if (multHostWarmKey === key && multHostCache.size > 0) return;
  await loadSvgMultiplierAssets();
  await ensureTicketFontsForLayout(layout.metrics);
  const dab = layout.metrics.dabSize;
  const next = new Map<string, MultHostSprite>();
  for (const face of ["normal", "gold", "disabled"] as const) {
    const disabled = face === "disabled";
    const disc = discDataUrl(disabled);
    if (!disc) continue;
    for (const value of MULTIPLIER_VALUES) {
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;left:-10000px;top:0;opacity:0.001;pointer-events:none;overflow:hidden";
      probe.style.width = `${dab}px`;
      probe.style.height = `${dab}px`;
      applyTicketCssVars(probe, layout.metrics);
      probe.append(multiplierHostSvg(String(value), dab, disabled, disc));
      document.body.append(probe);
      try {
        const bitmap = await rasterizeTicketSvg(probe, dpr, 0, layout.metrics);
        if (bitmap.width > 0 && bitmap.height > 0) {
          next.set(`${face}|${value}`, { bitmap });
        }
      } catch {
        // Fall back to compare badge atlas at paint time.
      } finally {
        probe.remove();
      }
    }
  }
  if (next.size === 0) return;
  multHostWarmKey = key;
  multHostCache.clear();
  for (const [k, v] of next) multHostCache.set(k, v);
}

function multHostBitmapUsable(sprite: MultHostSprite | undefined): boolean {
  return Boolean(sprite && sprite.bitmap.width > 0 && sprite.bitmap.height > 0);
}

export function clipTicketRoundRectDevice(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  cardWidthCss: number,
  cardHeightCss: number,
  radiusCss: number,
  dpr: number,
): void {
  const w = Math.round(cardWidthCss * dpr);
  const h = Math.round(cardHeightCss * dpr);
  const r = Math.min(Math.round(radiusCss * dpr), w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(originX + r, originY);
  ctx.arcTo(originX + w, originY, originX + w, originY + h, r);
  ctx.arcTo(originX + w, originY + h, originX, originY + h, r);
  ctx.arcTo(originX, originY + h, originX, originY, r);
  ctx.arcTo(originX, originY, originX + w, originY, r);
  ctx.closePath();
  ctx.clip();
}

/** Compare reuses the warm body band; catalog SVG chrome already paints the body. */
export type SvgAllBadgeBlit = "body-band" | "badge-host";

export function paintSvgAllCompareTicket(
  ctx: CanvasRenderingContext2D,
  ticket: Ticket,
  pack: ComparePaintPack,
  layout: CatalogLayout,
  cellX: readonly number[],
  cellW: number,
  face: "normal" | "gold" | "disabled",
  originX: number,
  originY: number,
  dpr: number,
  badgeBlit: SvgAllBadgeBlit = "body-band",
  cells?: readonly CellBox[],
): void {
  const m = layout.metrics;
  const pad = Math.round(16 * dpr);
  const width = Math.round(cellW * dpr);
  const bandY = originY + Math.round(m.headerHeight * dpr);
  const bodyTopDev = Math.round(m.headerHeight * dpr);

  for (let i = 0; i < 6; i++) {
    const mult = ticketCellMultiplier(ticket, i);
    if (!ticket.hits.includes(i) && !mult) continue;
    const badge = pack.badges.get(`${face}|${mult || 1}`);
    if (!badge) continue;
    if (badgeBlit === "badge-host" && cells?.[i]) {
      const cell = cells[i]!;
      const host = badgeHostDevice(cell, m.dabSize, dpr);
      const cellLeftDev = Math.round(cellX[i]! * dpr);
      const srcX = host.x - cellLeftDev + pad;
      const srcY = host.y - bodyTopDev;
      ctx.drawImage(
        badge.bitmap,
        srcX,
        srcY,
        host.w,
        host.h,
        originX + host.x,
        originY + host.y,
        host.w,
        host.h,
      );
      continue;
    }
    ctx.drawImage(
      badge.bitmap,
      pad,
      0,
      width,
      badge.bitmap.height,
      originX + Math.round(cellX[i]! * dpr),
      bandY,
      width,
      badge.bitmap.height,
    );
  }

  for (let i = 0; i < 6; i++) {
    if (ticket.hits.includes(i) || ticketCellMultiplier(ticket, i)) continue;
    const ball = ticket.balls[i] ?? 0;
    const patch = pack.numberPatches.get(`${Boolean(ticket.disabled)}|${face}|${ball}`);
    if (!patch) continue;
    ctx.drawImage(
      patch.sprite.bitmap,
      originX + Math.round(cellX[i]! * dpr) + patch.dx,
      bandY + patch.dy,
    );
  }
}

/**
 * Catalog tiles: compare body-band badges, then DOM-matched multiplier host sprites
 * (atlas body-band often bakes disc without label ink).
 */
export function paintSvgAllCatalogTicketInk(
  ctx: CanvasRenderingContext2D,
  ticket: Ticket,
  pack: ComparePaintPack,
  layout: CatalogLayout,
  cellX: readonly number[],
  cellW: number,
  face: "normal" | "gold" | "disabled",
  originX: number,
  originY: number,
  dpr: number,
  cells: readonly CellBox[],
): void {
  paintSvgAllCompareTicket(
    ctx,
    ticket,
    pack,
    layout,
    cellX,
    cellW,
    face,
    originX,
    originY,
    dpr,
  );

  const m = layout.metrics;
  for (let i = 0; i < 6; i++) {
    const mult = ticketCellMultiplier(ticket, i);
    if (!mult || !ticket.hits.includes(i)) continue;
    const sprite = multHostCache.get(`${face}|${mult}`);
    if (!multHostBitmapUsable(sprite)) continue;
    const cell = cells[i];
    if (!cell) continue;
    const host = badgeHostDevice(cell, m.dabSize, dpr);
    ctx.drawImage(sprite!.bitmap, originX + host.x, originY + host.y, host.w, host.h);
  }
}
