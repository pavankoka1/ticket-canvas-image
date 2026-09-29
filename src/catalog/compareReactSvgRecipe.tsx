/**
 * Compare lab: live native <svg> vs reactSvgRaster canvas (tutorial recipe).
 */

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { activeDpr } from "./cellBoxModel";
import {
  MultiplierBadgeSvg,
  multiplierBadgeStyleBlock,
} from "./MultiplierBadgeSvg";
import {
  clearReactSvgRasterCache,
  loadFontDataUrl,
  rasterizeReactSvg,
} from "./reactSvgRaster";

const FONT_URL = "/fonts/onest-700.woff2";
const BADGE_CSS = 28;

export function CompareReactSvgRecipe() {
  const liveRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [note, setNote] = useState("…");

  useEffect(() => {
    const host = liveRef.current;
    if (!host) return;
    const root = createRoot(host);
    root.render(<MultiplierBadgeSvg value={5} size={BADGE_CSS} active />);
    return () => root.unmount();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let cancelled = false;
    const dpr = activeDpr();
    const px = Math.round(BADGE_CSS * dpr);

    void (async () => {
      clearReactSvgRasterCache();
      const fontData = await loadFontDataUrl(FONT_URL);
      const fontFace = `@font-face{font-family:'MB-Onest';font-weight:700;src:url(${fontData}) format('woff2');}`;
      const canvas = await rasterizeReactSvg({
        cacheKey: `badge|5|${px}|${dpr}`,
        pxW: px,
        pxH: px,
        element: <MultiplierBadgeSvg value={5} size={BADGE_CSS} active />,
        style: {
          fontFaceCss: fontFace,
          css: multiplierBadgeStyleBlock("'MB-Onest'"),
        },
      });
      if (cancelled) return;
      if (c.width !== canvas.width || c.height !== canvas.height) {
        c.width = canvas.width;
        c.height = canvas.height;
      }
      c.style.width = `${BADGE_CSS}px`;
      c.style.height = `${BADGE_CSS}px`;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(canvas, 0, 0);
      setNote(`${canvas.width}×${canvas.height} · renderToStaticMarkup → data URL`);
    })().catch((err: unknown) => {
      if (!cancelled) setNote(err instanceof Error ? err.message : "raster failed");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="compare__fullSnap">
      <h2 className="compare__caseTitle">
        React SVG recipe · 5× badge (live &lt;svg&gt; vs canvas)
      </h2>
      <p className="compare__snapNote">{note}</p>
      <div
        className="compare__stack compare__stack_badgeRecipe"
        style={{ width: BADGE_CSS, height: BADGE_CSS }}
      >
        <div
          ref={liveRef}
          className="compare__liveSvg"
          style={{ position: "absolute", inset: 0, zIndex: 1 }}
        />
        <canvas
          ref={canvasRef}
          className="compare__canvas"
          style={{ mixBlendMode: "difference", opacity: 0.85 }}
        />
      </div>
    </section>
  );
}
