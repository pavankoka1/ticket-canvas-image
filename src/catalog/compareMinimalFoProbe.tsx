/**
 * Isolation probe: one centered glyph in a 50×50 box, same FO stack as tickets.
 * Flat black @ difference 1.0 ⇒ overlay path is sound; fringing ⇒ FO text vs HTML.
 */

import { useLayoutEffect, useRef, useState } from "react";

import { layoutCompareRasterCanvas } from "./compareDomAlign";
import { rasterizeElementSvg } from "./ticketSvgRaster";

const PROBE_CSS = 50;

export type CompareMinimalFoProbeProps = {
  rasterRatio: number;
  paintGen: number;
  canvasOpacity: number;
  blend: "normal" | "difference";
  showDom: boolean;
  showCanvas: boolean;
};

export function CompareMinimalFoProbe({
  rasterRatio,
  paintGen,
  canvasOpacity,
  blend,
  showDom,
  showCanvas,
}: CompareMinimalFoProbeProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [note, setNote] = useState("waiting…");

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!wrap || !canvas || !box) return;
    box.style.visibility = showDom ? "visible" : "hidden";
    box.style.zIndex = "1";
    if (!wrap.contains(box)) wrap.insertBefore(box, canvas);
  });

  useLayoutEffect(() => {
    if (paintGen < 1) return;

    let cancelled = false;
    const dpr = rasterRatio;

    void (async () => {
      const box = boxRef.current;
      const c = canvasRef.current;
      const wrap = wrapRef.current;
      if (!box || !c || !wrap || cancelled || !wrap.contains(box)) return;

      try {
        setNote("rasterizing 50×50 FO…");
        const raw = await rasterizeElementSvg(box, dpr);
        if (cancelled) return;
        layoutCompareRasterCanvas(c, raw, PROBE_CSS, PROBE_CSS);
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(raw, 0, 0);
        setNote(`${raw.width}×${raw.height} · raster ${dpr}×`);
      } catch (err: unknown) {
        if (!cancelled) setNote(err instanceof Error ? err.message : "svg failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [paintGen, showDom, rasterRatio]);

  return (
    <section className="compare__fullSnap compare__foProbe">
      <h2 className="compare__caseTitle">FO probe · 50×50 · “100” centered</h2>
      <p className="compare__snapNote">{note}</p>
      <div
        ref={wrapRef}
        className="compare__stack"
        style={{ width: PROBE_CSS, height: PROBE_CSS }}
      >
        <div
          ref={boxRef}
          className="compare__foProbeBox"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: PROBE_CSS,
            height: PROBE_CSS,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: 0,
            transform: "none",
            fontFamily: "MB-Onest, Onest, system-ui, sans-serif",
            fontSize: 18,
            fontWeight: 700,
            lineHeight: 1,
            color: "#704f4f",
            background: "#ffffff",
          }}
        >
          100
        </div>
        <canvas
          ref={canvasRef}
          className="compare__canvas"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            opacity: showCanvas && paintGen > 0 ? canvasOpacity : 0,
            mixBlendMode: blend,
          }}
        />
      </div>
    </section>
  );
}
