/** Compare-only reusable HTML/CSS sprites. No catalog cache or geometry mutation. */
import { loadSprites, saveSprites } from './atlasStore';
import { activeDpr, badgeHostDevice, resolveCellBoxModel } from './cellBoxModel';
import { usesSvgMultiplier } from './compareRenderMode';
import { applySvgMultiplier } from './compareSvgMultiplier';
import type { CatalogLayout } from './catalogLayout';
import { applyTicketCellLayout, TicketCard } from './ticketCardElement';
import { ensureTicketFontsForLayout } from './ticketFont';
import { isWinTicket, MULTIPLIER_VALUES, type Ticket } from './tickets';
import { composeCompareInkPatch, decodeCompareSvgBlob, rasterizeCompareTicketSvg, rasterSvgBlob, type CompareRasterPart } from './ticketSvgRaster';

const TRANSPARENT = `:root{background:transparent!important}.ticketCard,.ticketCard__header,.ticketCard__body{background:none!important;box-shadow:none!important}.ticketCard__cell::before{visibility:hidden!important}`;
type Sprite = { bitmap: HTMLCanvasElement; blob: Blob };
const sprites = new Map<string, Promise<Sprite>>();
const packs = new Map<string, Promise<Pack>>();
type Pack = { numbers: Sprite[][]; badges: Map<string, Sprite>; prefix: string };

function prefix(layout: CatalogLayout, dpr: number): string {
  return `compare-sprites-v20|html-zoom|whole-css-origin|${usesSvgMultiplier() ? 'svg-mult' : 'html-mult'}|${JSON.stringify(layout)}|${dpr}|MB-Onest-700|center-header`;
}

async function cached(key: string, capture: () => Promise<HTMLCanvasElement>): Promise<Sprite> {
  let pending = sprites.get(key);
  if (!pending) {
    pending = (async () => {
      const stored = await loadSprites(key);
      const blob = stored?.blobs[0];
      if (blob) {
        const meta = stored.meta;
        const source = meta && typeof meta === 'object' && 'source' in meta && meta.source instanceof Blob
          ? meta.source : blob;
        const bitmap = await decodeCompareSvgBlob(blob).catch(() => null);
        // An empty stored sprite (written by an earlier build) is never served;
        // fall through and recapture, overwriting the bad record.
        if (bitmap && bitmap.width > 0 && bitmap.height > 0) return { bitmap, blob: source };
      }
      const bitmap = await capture();
      if (bitmap.width < 1 || bitmap.height < 1) throw new Error('Compare sprite capture is empty');
      const captured = rasterSvgBlob(bitmap);
      if (!captured) throw new Error('Compare sprite has no SVG blob');
      const png = await new Promise<Blob | null>(resolve => bitmap.toBlob(resolve, 'image/png'));
      await saveSprites({ key, blobs: [png ?? captured], meta: { source: captured } });
      return { bitmap, blob: captured };
    })();
    sprites.set(key, pending);
    void pending.catch(() => sprites.delete(key));
  }
  return pending;
}

async function inkPatch(key: string, sprite: Sprite, gold = false, shiftX = 0): Promise<{ sprite: Sprite; x: number; y: number }> {
  const { width, height } = sprite.bitmap;
  const pixels = sprite.bitmap.getContext('2d')!.getImageData(0, 0, width, height).data;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!pixels[(y * width + x) * 4 + 3]) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left) return { sprite, x: 0, y: 0 };
  const bounds = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  const patch = await cached(`${key}|ink-patch`, () => composeCompareInkPatch(sprite.blob, bounds, TRANSPARENT, gold, shiftX));
  return { sprite: patch, x: left, y: top };
}

function hideHeader(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.ticketCard__id,.ticketCard__win').forEach(el => { el.style.visibility = 'hidden'; });
}

function sourceTicket(disabled: boolean, number = 1, badge = 0): Ticket {
  return { id: 'compare-cache-source', no: '0', balls: Array(6).fill(number) as number[], hits: badge ? [0] : [], multipliers: badge > 1 ? { 0: badge } : {}, win: '', disabled };
}

export function prepareCompareCard(card: TicketCard, layout: CatalogLayout, dpr: number): void {
  const model = resolveCellBoxModel(layout, dpr);
  const cells = [...card.dom.querySelectorAll<HTMLElement>('.ticketCard__cell')];
  applyTicketCellLayout(card.dom, cells, model, layout.metrics, layout.cardHeight);
  card.dom.classList.add('ticketCard_compare');
  cells.forEach((cell, i) => {
    const badge = cell.querySelector<HTMLElement>('.ticketCard__badgeHost');
    if (!badge) return;
    const box = badgeHostDevice(model.cells[i]!, layout.metrics.dabSize, dpr);
    Object.assign(badge.style, {
      left: `${box.leftCss}px`, top: `${box.topCss}px`,
      width: `${box.sizeCss}px`, height: `${box.sizeCss}px`,
      backgroundSize: 'contain', backgroundPosition: '0 0',
    });
  });
  applySvgMultiplier(card.dom, usesSvgMultiplier());
}

function warmPack(layout: CatalogLayout, dpr: number): Promise<Pack> {
  const key = prefix(layout, dpr);
  let pending = packs.get(key);
  if (pending) return pending;
  pending = (async () => {
    await ensureTicketFontsForLayout(layout.metrics);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none';
    host.setAttribute('aria-hidden', 'true');
    const card = new TicketCard();
    host.append(card.dom);
    document.body.append(host);
    const model = resolveCellBoxModel(layout, dpr);
    const m = layout.metrics;
    const numbers: Sprite[][] = [[], []];
    const badges = new Map<string, Sprite>();
    const capture = (part: CompareRasterPart) => rasterizeCompareTicketSvg(card.dom, dpr, m, part);
    try {
      for (const disabled of [false, true]) {
        for (let n = 1; n <= 60; n++) {
          card.bind(sourceTicket(disabled, n), 0, 0, layout);
          prepareCompareCard(card, layout, activeDpr());
          numbers[Number(disabled)]![n] = await cached(`${key}|number|${disabled}|${n}`, () => capture({
            crop: { x: 0, y: m.headerHeight, width: model.cellW, height: m.bodyHeight },
            css: TRANSPARENT,
            prepare(root) {
              hideHeader(root);
              root.querySelectorAll<HTMLElement>('.ticketCard__cell').forEach((cell, i) => { cell.style.visibility = i === 0 ? 'visible' : 'hidden'; });
            },
          }));
        }
      }
      // Precompose image antialiasing on the real body background. Re-compositing
      // an already rounded transparent image can change its edge colors.
      for (const face of ['normal', 'gold', 'disabled'] as const) {
        for (const value of [1, ...MULTIPLIER_VALUES]) {
          const ticket = sourceTicket(face === 'disabled');
          ticket.hits = face === 'gold' ? [1, 2] : [1];
          ticket.multipliers = value > 1 ? { 1: value } : {};
          card.bind(ticket, 0, 0, layout);
          prepareCompareCard(card, layout, activeDpr());
          const badgeKey = `${face}|${value}`;
          badges.set(badgeKey, await cached(`${key}|badge-body|${badgeKey}`, () => capture({
            crop: { x: model.cells[1]!.x - 16, y: m.headerHeight, width: model.cellW + 32, height: m.bodyHeight },
            css: '.ticketCard__body{border-radius:0!important}',
            prepare(root) {
              hideHeader(root);
              root.querySelectorAll<HTMLElement>('.ticketCard__cell').forEach((cell, i) => {
                for (const node of [...cell.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.textContent = '';
                if (i !== 1) cell.querySelectorAll<HTMLElement>('.ticketCard__badgeHost').forEach(badge => { badge.style.visibility = 'hidden'; });
              });
            },
          })));
        }
      }
      return { numbers, badges, prefix: key };
    } finally { host.remove(); }
  })();
  packs.set(key, pending);
  void pending.catch(() => packs.delete(key));
  return pending;
}

export async function assembleCompareSprites(live: HTMLElement, ticket: Ticket, layout: CatalogLayout, dpr: number): Promise<HTMLCanvasElement> {
  const pack = await warmPack(layout, dpr);
  const m = layout.metrics;
  const capture = (part: CompareRasterPart) => rasterizeCompareTicketSvg(live, dpr, m, part);
  const model = resolveCellBoxModel(layout, dpr);
  const face = ticket.disabled ? 'disabled' : isWinTicket(ticket) ? 'gold' : 'normal';
  // Live-card captures depend on the card's layout-origin fraction (WebKit text
  // rounding). Key them by it so a capture taken mid-reflow can never be reused
  // at a settled whole-pixel origin.
  const liveRect = live.getBoundingClientRect();
  const frac = (v: number) => (v - Math.round(v)).toFixed(4);
  const origin = `o${frac(liveRect.left + window.scrollX)},${frac(liveRect.top + window.scrollY)}`;
  const liveKey = `${pack.prefix}|${origin}`;
  const chrome = await cached(`${liveKey}|chrome|${face}`, () => capture({
    css: '.ticketCard__cell::before{visibility:visible!important}',
    prepare(root) {
      hideHeader(root);
      root.querySelectorAll<HTMLElement>('.ticketCard__cell').forEach(cell => { for (const node of [...cell.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.textContent = ''; });
      root.querySelectorAll<HTMLElement>('.ticketCard__badgeHost').forEach(el => { el.style.visibility = 'hidden'; });
    },
  }));
  const headerPart = (selector: string): CompareRasterPart => ({
    crop: { x: 0, y: 0, width: layout.cardWidth, height: m.headerHeight },
    css: TRANSPARENT,
    prepare(root) {
      hideHeader(root);
      root.querySelector<HTMLElement>(selector)!.style.visibility = 'visible';
      root.querySelector<HTMLElement>('.ticketCard__body')!.style.visibility = 'hidden';
    },
  });
  const idElement = live.querySelector<HTMLElement>('.ticketCard__id')!;
  const text = idElement.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('Compare ID text missing');
  const rootRect = live.getBoundingClientRect();
  const ids: { sprite: Sprite; x: number; y: number }[] = [];
  for (let i = 0; i < ticket.no.length; i++) {
    const range = document.createRange();
    range.setStart(text, i);
    range.setEnd(text, i + 1);
    const rect = range.getBoundingClientRect();
    const start = (rect.left - rootRect.left) * dpr;
    const x = Math.floor(start);
    const right = i === ticket.no.length - 1
      ? Math.ceil((rect.right - rootRect.left) * dpr)
      : Math.floor((rect.right - rootRect.left) * dpr);
    const width = right - x;
    const phase = Math.round((start - x) * 64);
    const part = headerPart('.ticketCard__id');
    part.crop = { x: x / dpr, y: 0, width: width / dpr, height: m.headerHeight };
    const sprite = await cached(`${liveKey}|id-digit|${face}|${ticket.no[i]}|${phase}|${width}`,
      () => capture(part));
    const patch = await inkPatch(`${liveKey}|id-digit|${face}|${ticket.no[i]}|${phase}|${width}`, sprite);
    ids.push({ sprite: patch.sprite, x: x + patch.x, y: patch.y });
  }
  const amount = isWinTicket(ticket) && ticket.win
    ? await cached(`${liveKey}|amount|${face}|${ticket.win}`, () => capture(headerPart('.ticketCard__win')))
    : null;
  const amountPatch = amount ? await inkPatch(`${liveKey}|amount|${face}|${ticket.win}`, amount) : null;
  const numberPatches = await Promise.all(ticket.balls.map((ball, i) => ticket.hits.includes(i) || ticket.multipliers[i]
    ? Promise.resolve(null)
    : inkPatch(`${pack.prefix}|number-surface|${face}|${ball}|${i}`, pack.numbers[Number(Boolean(ticket.disabled))]![ball]!, face === 'gold', model.cells[i]!.x))); 
  const out = document.createElement('canvas');
  out.width = Math.round(layout.cardWidth * dpr);
  out.height = Math.round(layout.cardHeight * dpr);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Compare 2D context unavailable');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(chrome.bitmap, 0, 0);
  for (const id of ids) ctx.drawImage(id.sprite.bitmap, id.x, id.y);
  if (amountPatch) ctx.drawImage(amountPatch.sprite.bitmap, amountPatch.x, amountPatch.y);
  for (let i = 0; i < 6; i++) {
    const x = Math.round(model.cells[i]!.x * dpr);
    const y = Math.round(m.headerHeight * dpr);
    const mult = ticket.multipliers[i] ?? 0;
    if (ticket.hits.includes(i) || mult) {
      const badge = pack.badges.get(`${face}|${mult || 1}`)!;
      const pad = Math.round(16 * dpr);
      const width = Math.round(model.cellW * dpr);
      ctx.drawImage(badge.bitmap, pad, 0, width, badge.bitmap.height,
        x, y, width, badge.bitmap.height);
    }
  }
  // Paint numbers after the padded badge backgrounds, so padding never erases
  // adjacent numbers.
  for (let i = 0; i < 6; i++) {
    if (ticket.hits.includes(i) || ticket.multipliers[i]) continue;
    const patch = numberPatches[i]!;
    ctx.drawImage(patch.sprite.bitmap,
      Math.round(model.cells[i]!.x * dpr) + patch.x, Math.round(m.headerHeight * dpr) + patch.y);
  }
  return out;
}
