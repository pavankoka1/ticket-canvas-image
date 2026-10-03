/** Warm and stamp svg-all header glyphs (id + amount) for /compare task 8.8. */
import { svgEl } from "./compareSvgMultiplier";
import {
  compareGlyphPhaseCount,
  compareGlyphPhaseShiftCss,
  quantizeGlyphDeviceX,
} from "./compareGlyphEngine";
import { OVERLAY_CLASS } from "./compareSvgText";
import type { CompareRasterPart } from "./ticketSvgRaster";

export const AMOUNT_GLYPHS = "0123456789$,.";
const GLYPH_REF_X0 = 6;
const GLYPH_REF_STEP = 20;
const HEADER_BASELINE_EM = 0.36;
const HEADER_FONT = "MB-Onest, Onest, sans-serif";
const HEADER_TEXT_STYLE = "font-kerning:none;font-feature-settings:'kern' 0";

type Sprite = { bitmap: HTMLCanvasElement; blob: Blob };

export type HeaderGlyphPack = {
  id: Map<string, Sprite>;
  amount: Map<string, Sprite>;
  phases: number;
};

function glyphKey(fill: string, char: string, phase: number): string {
  return `${fill}|${char}|${phase}`;
}

type HeaderField = "id" | "amount";

export function glyphCapturePad(dpr: number): number {
  return Math.max(2, Math.round(2 * dpr));
}

/** Wide enough for every isolated glyph slot (checks A–C grid), independent of ticket preset width. */
export function glyphWarmMinCardWidthCss(): number {
  const slots = Math.max(10, AMOUNT_GLYPHS.length);
  return GLYPH_REF_X0 + slots * GLYPH_REF_STEP + GLYPH_REF_STEP;
}

export function widenCardForGlyphWarm(root: HTMLElement): void {
  const minW = glyphWarmMinCardWidthCss();
  const w = Math.max(cssVarPx(root, "--ticket-card-width"), minW);
  root.style.width = `${w}px`;
  root.style.setProperty("--ticket-card-width", String(w));
}

function cssVarPx(root: HTMLElement, name: string): number {
  return parseFloat(root.style.getPropertyValue(name)) || 0;
}

function headerBaselineY(root: HTMLElement): number {
  const headerH = cssVarPx(root, "--ticket-header-height");
  const metaPx = cssVarPx(root, "--ticket-meta-font-size");
  return headerH / 2 + HEADER_BASELINE_EM * metaPx;
}

function overlayHeaderText(root: HTMLElement, field: HeaderField): SVGTextElement {
  const overlay = root.querySelector(`.${OVERLAY_CLASS}`);
  if (!overlay) throw new Error("compare glyph: svg overlay missing");
  const anchor = field === "amount" ? "start" : "end";
  const el = [...overlay.querySelectorAll<SVGTextElement>("text")].find(
    (t) => t.getAttribute("text-anchor") === anchor,
  );
  if (!el) throw new Error(`compare glyph: overlay ${field} text missing`);
  return el;
}

function glyphScreenX(root: HTMLElement, el: SVGTextElement, index: number): number {
  const pt = el.getStartPositionOfChar(index);
  const m = el.getScreenCTM();
  if (!m) throw new Error("compare glyph: no screen CTM");
  const p = new DOMPoint(pt.x, pt.y).matrixTransform(m);
  const rootRect = root.getBoundingClientRect();
  return p.x - rootRect.left;
}

function measureHeaderGlyphDeviceX(
  root: HTMLElement,
  field: HeaderField,
  index: number,
  dpr: number,
): number {
  const el = overlayHeaderText(root, field);
  const len = el.textContent?.length ?? 0;
  if (index < 0 || index >= len) {
    throw new Error(`compare glyph: ${field} index ${index} of ${len}`);
  }
  return glyphScreenX(root, el, index) * dpr;
}

function refGlyphCrop(
  refXCss: number,
  dpr: number,
  headerHeight: number,
): { x: number; y: number; width: number; height: number } {
  const pad = glyphCapturePad(dpr);
  const leftDevice = Math.max(0, Math.floor(refXCss * dpr) - pad);
  return {
    x: leftDevice / dpr,
    y: 0,
    width: GLYPH_REF_STEP,
    height: headerHeight,
  };
}

function isolatedGlyphPart(
  char: string,
  fill: string,
  refXCss: number,
  phase: number,
  phases: number,
  dpr: number,
  headerHeight: number,
  transparentCss: string,
): CompareRasterPart {
  const xCss = refXCss + compareGlyphPhaseShiftCss(phase, dpr, phases);
  return {
    crop: refGlyphCrop(refXCss, dpr, headerHeight),
    css: transparentCss,
    prepare(root) {
      root.querySelector<HTMLElement>(".ticketCard__body")!.style.visibility = "hidden";
      const overlay = root.querySelector(`.${OVERLAY_CLASS}`);
      if (!overlay) throw new Error("compare glyph: overlay missing");
      for (const node of [...overlay.children]) {
        if (node.nodeName.toLowerCase() !== "defs") node.remove();
      }
      const metaPx = cssVarPx(root, "--ticket-meta-font-size");
      const headerY = headerBaselineY(root);
      const t = svgEl("text", {
        x: xCss,
        y: headerY,
        "text-anchor": "start",
        "font-family": HEADER_FONT,
        "font-weight": 700,
        "font-size": metaPx,
        fill,
      });
      t.setAttribute("style", HEADER_TEXT_STYLE);
      t.textContent = char;
      overlay.append(t);
    },
  };
}

const ID_FILLS = {
  normal: "#b19797",
  gold: "#9f8080",
  disabled: "#0f6864",
} as const;

const AMOUNT_FILLS = {
  normal: "#704f4f",
  gold: "#704f4f",
  disabled: "#0f6864",
} as const;

export async function warmHeaderGlyphPack(
  key: string,
  cached: (cacheKey: string, capture: () => Promise<HTMLCanvasElement>) => Promise<Sprite>,
  capture: (part: CompareRasterPart) => Promise<HTMLCanvasElement>,
  bindFace: (face: "normal" | "gold" | "disabled", idChar: string, winChar: string) => void,
  afterBind: () => void,
  _liveRoot: HTMLElement,
  dpr: number,
  headerHeight: number,
  transparentCss: string,
): Promise<HeaderGlyphPack> {
  const phases = compareGlyphPhaseCount();
  const id = new Map<string, Sprite>();
  const amount = new Map<string, Sprite>();

  for (const face of ["normal", "gold", "disabled"] as const) {
    const idFill = ID_FILLS[face];
    for (let digit = 0; digit <= 9; digit++) {
      const ch = String(digit);
      const refX = GLYPH_REF_X0 + digit * GLYPH_REF_STEP;
      bindFace(face, ch, "");
      afterBind();
      for (let phase = 0; phase < phases; phase++) {
        const part = isolatedGlyphPart(ch, idFill, refX, phase, phases, dpr, headerHeight, transparentCss);
        const sprite = await cached(`${key}|glyph-id|${idFill}|${ch}|${phase}|iso`, () => capture(part));
        id.set(glyphKey(idFill, ch, phase), sprite);
      }
    }
  }

  const sharedAmountFill = AMOUNT_FILLS.normal;
  for (let i = 0; i < AMOUNT_GLYPHS.length; i++) {
    const ch = AMOUNT_GLYPHS[i]!;
    const refX = GLYPH_REF_X0 + i * GLYPH_REF_STEP;
    bindFace("gold", "", ch);
    afterBind();
    for (let phase = 0; phase < phases; phase++) {
      const part = isolatedGlyphPart(ch, sharedAmountFill, refX, phase, phases, dpr, headerHeight, transparentCss);
      const sprite = await cached(`${key}|glyph-amt|${sharedAmountFill}|${encodeURIComponent(ch)}|${phase}|iso`, () =>
        capture(part),
      );
      amount.set(glyphKey(sharedAmountFill, ch, phase), sprite);
      amount.set(glyphKey(AMOUNT_FILLS.gold, ch, phase), sprite);
    }
  }

  const disabledFill = AMOUNT_FILLS.disabled;
  for (let i = 0; i < AMOUNT_GLYPHS.length; i++) {
    const ch = AMOUNT_GLYPHS[i]!;
    const refX = GLYPH_REF_X0 + i * GLYPH_REF_STEP;
    bindFace("disabled", "", ch);
    afterBind();
    for (let phase = 0; phase < phases; phase++) {
      const part = isolatedGlyphPart(ch, disabledFill, refX, phase, phases, dpr, headerHeight, transparentCss);
      const sprite = await cached(`${key}|glyph-amt|${disabledFill}|${encodeURIComponent(ch)}|${phase}|iso`, () =>
        capture(part),
      );
      amount.set(glyphKey(disabledFill, ch, phase), sprite);
    }
  }

  return { id, amount, phases };
}

export type InkPatch = { sprite: Sprite; x: number; y: number };

export async function stampHeaderGlyphs(
  ctx: CanvasRenderingContext2D,
  live: HTMLElement,
  ticketNo: string,
  win: string,
  face: "normal" | "gold" | "disabled",
  dpr: number,
  pack: HeaderGlyphPack,
  inkPatch: (key: string, sprite: Sprite) => Promise<InkPatch>,
  keyPrefix: string,
): Promise<void> {
  const idFill = ID_FILLS[face];
  const amountFill = AMOUNT_FILLS[face];
  const phases = pack.phases;
  const pad = glyphCapturePad(dpr);

  for (let i = 0; i < ticketNo.length; i++) {
    const ch = ticketNo[i] ?? "";
    const start = measureHeaderGlyphDeviceX(live, "id", i, dpr);
    const { pixel, phase } = quantizeGlyphDeviceX(start, phases);
    const sprite = pack.id.get(glyphKey(idFill, ch, phase));
    if (!sprite) continue;
    const patch = await inkPatch(`${keyPrefix}|stamp-id|${face}|${i}|${ch}|${phase}`, sprite);
    ctx.drawImage(patch.sprite.bitmap, pixel - pad + patch.x, patch.y);
  }

  if (!win) return;
  for (let i = 0; i < win.length; i++) {
    const ch = win[i] ?? "";
    const start = measureHeaderGlyphDeviceX(live, "amount", i, dpr);
    const { pixel, phase } = quantizeGlyphDeviceX(start, phases);
    const sprite = pack.amount.get(glyphKey(amountFill, ch, phase));
    if (!sprite) continue;
    const patch = await inkPatch(`${keyPrefix}|stamp-amt|${face}|${i}|${encodeURIComponent(ch)}|${phase}`, sprite);
    ctx.drawImage(patch.sprite.bitmap, pixel - pad + patch.x, patch.y);
  }
}
