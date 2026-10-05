/**
 * Shared svg-all canvas composite (compare optimized + catalog tiles).
 * Matches assembleWithOverlay in compareCachedSprites at v52: chrome, padded
 * badge-body sprites at headerHeight, number patches, then header glyphs.
 */

import { badgeHostDevice, type CellBox } from "./cellBoxModel";
import type { CatalogLayout } from "./catalogLayout";
import type { ComparePaintPack } from "./compareCachedSprites";
import type { Ticket } from "./tickets";

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
    const mult = ticket.multipliers[i] ?? 0;
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
    if (ticket.hits.includes(i) || ticket.multipliers[i]) continue;
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
