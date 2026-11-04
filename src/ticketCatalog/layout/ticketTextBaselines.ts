import { snappedTicketBodyPaddingY, type TicketMetrics } from "../model/ticketPresets";
import { activeDpr, snapCss } from "./cellBoxModel";
import { isWebKitEngine } from "./catalogOriginSnap";

/** Where Fortunamania's HTML ticket puts its text baselines on this engine, in CSS px. */
export type TicketTextBaselines = {
  /** Header id / amount baseline, from the card top. */
  header: number;
  /** Cell number baseline, from the card top. */
  number: number;
  /** Multiplier label baseline, from the badge centre (unrotated). */
  multiplier: number;
};

const FONT_FAMILY = "MB-Onest";
const cache = new Map<string, TicketTextBaselines>();

/**
 * The SVG overlay places text at explicit baselines, so they must be read from the
 * real line boxes: half-leading and ascent rounding differ between Blink and WebKit,
 * and no em constant matches both. The probe matches catalog DOM: snapped body
 * padding from `applyTicketDprVars`. Header and number baselines are then snapped the
 * way each engine paints HTML text: Blink rounds the baseline to a whole CSS px
 * (measured at DPR 2 and 3), WebKit to the device pixel. The multiplier label is
 * rotated, so its baseline is left exact.
 */
export function resolveTicketTextBaselines(m: TicketMetrics, dpr = activeDpr()): TicketTextBaselines {
  const key = [
    m.id,
    m.headerHeight,
    m.bodyPaddingY,
    m.cellHeight,
    m.numberLineHeight,
    m.numberFontSize,
    m.metaFontSize,
    m.cellMarginTop,
    m.numberDrop,
    m.dabSize,
    dpr,
  ].join("|");
  const hit = cache.get(key);
  if (hit) return hit;
  const raw = measureFmBaselines(m, dpr);
  const snap = isWebKitEngine() ? (v: number) => Math.round(v * dpr) / dpr : Math.round;
  const out = { header: snap(raw.header), number: snap(raw.number), multiplier: raw.multiplier };
  const multPx = (13 * m.dabSize) / 24;
  const fontsReady =
    document.fonts.check(`700 ${m.numberFontSize}px ${FONT_FAMILY}`) &&
    document.fonts.check(`700 ${m.metaFontSize}px ${FONT_FAMILY}`) &&
    document.fonts.check(`700 ${multPx}px ${FONT_FAMILY}`);
  if (fontsReady) cache.set(key, out);
  return out;
}

/** Cache key fragment so baked sprites follow the measured baselines. */
export function ticketTextBaselinesKey(m: TicketMetrics, dpr = activeDpr()): string {
  const b = resolveTicketTextBaselines(m, dpr);
  return `${b.header.toFixed(4)}/${b.number.toFixed(4)}/${b.multiplier.toFixed(4)}`;
}

function el(tag: string, css: string, ...children: (Node | string)[]): HTMLElement {
  const node = document.createElement(tag);
  node.style.cssText = css;
  node.append(...children);
  return node;
}

/** Zero-size inline-block: its top edge is the baseline of the line it sits on. */
function baselineMark(): HTMLElement {
  return el("span", "display:inline-block;width:0;height:0;vertical-align:baseline");
}

function measureFmBaselines(m: TicketMetrics, dpr: number): TicketTextBaselines {
  const multPx = (13 * m.dabSize) / 24;
  const bodyPad = snappedTicketBodyPaddingY(m, dpr);
  const cellH = snapCss(m.cellHeight, dpr);
  const idMark = baselineMark();
  const header = el(
    "div",
    `display:flex;flex-shrink:0;align-items:stretch;justify-content:space-between;height:${m.headerHeight}px;` +
      `padding:0 ${m.headerPadX}px;overflow:hidden`,
    el(
      "span",
      `display:flex;height:100%;margin-left:auto;min-width:0;font-size:${m.metaFontSize}px;font-weight:700;` +
        "line-height:normal;text-align:right;flex:1 0 0;flex-direction:column;justify-content:flex-end",
      el("span", "", "123", idMark),
    ),
  );
  const numberMark = baselineMark();
  const multMark = baselineMark();
  const badge = el(
    "span",
    `position:absolute;display:flex;top:0;left:0;width:${m.dabSize}px;height:${m.dabSize}px;` +
      "align-items:center;justify-content:center",
    el(
      "span",
      "position:absolute;display:flex;inset:0;align-items:center;justify-content:center",
      el(
        "span",
        `position:relative;display:inline-flex;align-items:center;font-family:'${FONT_FAMILY}',sans-serif;` +
          `font-size:${multPx}px;font-weight:700;line-height:1.0041em;letter-spacing:-0.01em`,
        el(
          "span",
          "display:block;white-space:nowrap",
          el("span", "", "2"),
          el("span", "margin-left:0.06em;font-size:0.769em", "\u00d7"),
          multMark,
        ),
      ),
    ),
  );
  const body = el(
    "div",
    "position:relative;display:flex;flex-flow:row;flex-shrink:0;align-items:flex-start;" +
      `justify-content:flex-start;box-sizing:border-box;height:${m.bodyHeight}px;padding:${bodyPad}px 0`,
    el(
      "span",
      `position:relative;display:flex;height:${cellH}px;margin-top:0;min-width:0;font-size:${m.numberFontSize}px;font-weight:700;` +
        `line-height:${m.numberLineHeight}px;flex:1 1 0;align-items:center;justify-content:center`,
      el("span", "", "88", numberMark),
    ),
  );
  const card = el(
    "div",
    `position:absolute;left:-10000px;top:0;display:flex;flex-direction:column;width:200px;` +
      `height:${m.cardHeight}px;font-family:${FONT_FAMILY},system-ui,sans-serif;box-sizing:border-box;` +
      "-webkit-font-smoothing:antialiased;text-rendering:geometricprecision;visibility:hidden;pointer-events:none",
    header,
    body,
    badge,
  );
  document.body.append(card);
  const top = card.getBoundingClientRect().top;
  const badgeRect = badge.getBoundingClientRect();
  const out = {
    header: idMark.getBoundingClientRect().top - top,
    number: numberMark.getBoundingClientRect().top - top,
    multiplier: multMark.getBoundingClientRect().top - (badgeRect.top + badgeRect.height / 2),
  };
  card.remove();
  return out;
}
