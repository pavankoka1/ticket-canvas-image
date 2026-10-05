#!/usr/bin/env python3
"""DOM-vs-canvas displacement analysis for /compare phone captures.

Usage: analyze.py <capture-dir> [--glyphs]

Pairs every `<tag>-dom.png` with `<tag>-cv.png` (same element, same scroll
position, native device scale). Tags must contain a preset id. Regions are
fixed crops in shared screenshot coordinates (never re-centred on ink):
header halves (amt = left, id = right) and the body split into six cells.

For each region it reports `bad` (pixels whose max channel delta > 32) and the bilinear displacement (dx, dy) of canvas vs DOM that best
explains the difference, searched on a 0.25 device-px grid in [-2, 2].
`(0,0)/n` means no displacement detected at that resolution (n strong-delta pixels
remain: softness or shape); see fmt() for the movement / partial / softness labels. Every region is searched regardless of
contrast; `bad` is informational only, never a pass rule.

--glyphs additionally splits the id region into ink runs (glyphs) and reports
each glyph's displacement independently.
"""
import os
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HEADER_CSS = {"desktopMedium": 17, "desktopSmall": 15, "mobile": 15, "mobileLarge": 17, "mobileCompact": 13}
RES = 0.25
ANALYZE_DPR = float(os.environ.get("ANALYZE_DPR", "3"))


def load(p):
    return np.asarray(Image.open(p).convert("RGB")).astype(float)


def displacement(a, b, gate=32):
    """Always searched: the colour gate only counts strong differences, it never
    skips a region (low-contrast text can move with every delta under it)."""
    bad = int((np.abs(a - b).max(2) > gate).sum())
    ga, gb = a.mean(2), b.mean(2)
    if not np.abs(ga - gb).max():
        return bad, None
    best = (np.inf, 0.0, 0.0)
    steps = np.arange(-2, 2 + 1e-9, RES)
    for dy in steps:
        for dx in steps:
            iy, ix = int(np.floor(dy)), int(np.floor(dx))
            fy, fx = dy - iy, dx - ix
            s = np.roll(np.roll(gb, -iy, 0), -ix, 1)
            s1, s2 = np.roll(s, -1, 1), np.roll(s, -1, 0)
            s3 = np.roll(s1, -1, 0)
            r = (1 - fx) * (1 - fy) * s + fx * (1 - fy) * s1 + (1 - fx) * fy * s2 + fx * fy * s3
            e = ((ga[3:-3, 3:-3] - r[3:-3, 3:-3]) ** 2).sum()
            if e < best[0]:
                best = (e, dx, dy)
            if dx == 0 and dy == 0:
                e0 = e
    # A shift counts only if it explains most of the difference (halves the
    # residual). Otherwise the difference is softness/shape, not movement.
    gain = 0.0 if e0 == 0 else 1 - best[0] / e0  # share of the residual the shift explains
    if max(abs(best[1]), abs(best[2])) >= 2:
        return bad, ("edge", gain)
    return bad, (best[1], best[2], gain)


def fmt(bad, d):
    """`(dx,dy)/bad` = movement (shift explains >= 50% of the residual);
    `~(dx,dy)NN%/bad` = partial movement (part of the region moved, e.g. one glyph);
    `(0,0)/bad` = no displacement detected (softness/shape); `inconclusive` = best fit at range edge."""
    if d is None:
        return "identical"
    if d[0] == "edge":
        return f"(inconclusive)/{bad}"
    dx, dy, gain = d
    if dx == 0 and dy == 0:
        return f"(0,0)/{bad}"
    if gain >= 0.5:
        return f"({dx:g},{dy:g})/{bad}"
    if gain >= 0.15:
        return f"~({dx:g},{dy:g}){gain:.0%}/{bad}"
    return f"(0,0)/{bad}"


def glyph_runs(dom, h):
    """Column ranges of ink in the id half, from the DOM image."""
    w = dom.shape[1]
    half = dom[:h, w // 2:].mean(2)
    ink = (np.median(half, 1, keepdims=True) - half) > 24
    cols = ink.any(0)
    runs, start = [], None
    for x, on in enumerate(cols):
        if on and start is None:
            start = x
        if not on and start is not None:
            runs.append((start, x))
            start = None
    if start is not None:
        runs.append((start, len(cols)))
    return [(w // 2 + max(0, a - 2), w // 2 + min(len(cols), b + 2)) for a, b in runs if b - a > 2]


def main():
    root = Path(sys.argv[1])
    glyphs = "--glyphs" in sys.argv
    for dom_path in sorted(root.glob("*-dom.png")):
        tag = dom_path.name[: -len("-dom.png")]
        cv_path = root / f"{tag}-cv.png"
        if not cv_path.exists():
            print(f"{tag}: MISSING canvas capture")
            continue
        preset = next((p for p in HEADER_CSS if re.search(rf"(^|-){p}(-|$)", tag)), None)
        if preset is None:
            print(f"{tag}: unknown preset")
            continue
        a, b = load(dom_path), load(cv_path)
        if a.shape != b.shape:
            print(f"{tag}: SIZE MISMATCH dom {a.shape} cv {b.shape}")
            continue
        H, W = a.shape[:2]
        h = int(round(HEADER_CSS[preset] * ANALYZE_DPR))
        regs = {"amt": (6, W // 2, 0, h), "id": (W // 2, W - 6, 0, h)}  # inset: skip rounded card corners
        for k in range(6):
            regs[f"c{k}"] = (round(k * W / 6), round((k + 1) * W / 6), h, H)
        out = []
        for name, (x0, x1, y0, y1) in regs.items():
            bad, d = displacement(a[y0:y1, x0:x1], b[y0:y1, x0:x1])
            if d is not None and (bad or (d[0] != 'edge' and (d[0] or d[1]))):
                out.append(f"{name}{fmt(bad, d)}")
        line = f"{tag} {W}x{H} | " + (" ".join(out) or "no displacement detected")
        if glyphs:
            g = []
            for x0, x1 in glyph_runs(a, h):
                bad, d = displacement(a[:h, x0:x1], b[:h, x0:x1], gate=8)
                g.append(f"[{x0}-{x1}]{fmt(bad, d)}")
            line += " | id glyphs " + " ".join(g)
        print(line)
    print(f"search resolution: {RES} device px; every region searched; bad = pixels with max channel delta > 32 (informational)")


if __name__ == "__main__":
    main()
