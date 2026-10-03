# Glyph atlas: build plan (task 8.8)

The `/compare` "SVG text: all" full-ticket row is the reference. The optimized row must match it with reused sprites only: no per-ticket raster. Evidence for every rule below is in `README.md` (checks A, B, C and the engine table).

## Rules the build must follow

| Content | Sprite | Placement | Phases |
|---|---|---|---|
| Cell numbers 1–60 | one whole centred run per number and fill (normal/gold share `#704f4f`; disabled is the second fill) | cell origin; column pitch is a whole device px | none (fraction baked in) |
| Multiplier labels 2/3/5/10 | one whole rotated group per value and face; the disc stays the PNG | badge position, same as today's overlay | none |
| Id digits 0–9 | per digit and fill (3 fills: `#b19797`, `#9f8080`, `#0f6864`) | x from `getStartPositionOfChar(i)` on the live `<text>` | WebKit: 2 half-pixel phases, stamp `v = floor(x·dpr·2 + ε)/2`, `p = floor(v)`, `q = (v−p)·2`. Chromium: 4 quarter-pixel phases, `v = floor(x·dpr·4 + ε)/4`, `q = (v−p)·4`. ε = 1e−3 |
| Amount glyphs `0–9 $ , .` | per glyph and fill (2 fills) | same as id | same as id |

- Only x is quantized. The baseline's fractional device y is baked into each sprite.
- Pick the rule by engine (WebKit vs Chromium). No startup pixel probe; `getImageData` on these rasters is unverified in Safari.
- Capture every sprite inside the card, on the card's pixel grid, with a transparent background (`:root{background:transparent}` plus hidden chrome). Never place a phase sprite past the card edge; capture one raster per phase if needed.
- Stamp with padding: blit from `p − pad` so anti-aliased fringes outside the typographic box survive.
- Cache keys: engine rule + layout + DPR + fill + glyph (+ phase on Chromium) + atlas revision. Reuse the existing v20 store with a new prefix.

## Build order

1. **Glyph capture helper.** From the live card's overlay, build an isolated card-origin SVG with the requested glyphs at whole-pixel reference x (plus `q/(4·dpr)` per phase on Chromium) and the real baseline y. Rasterize through `rasterizeCompareTicketSvg` with the transparent CSS. Crop per glyph with padding. One raster per fill (per phase on Chromium).
2. **Atlas cache.** Per preset: numbers (60 × 2), labels (4 × 3), id digits (10 × 3 × phases), amount glyphs (13 × 2 × phases). Warm once; persist like the existing pack.
3. **Stamping painter** in `assembleWithOverlay`: chrome + dab sprites as today, then numbers and labels at their positions, then id and amount glyphs at the quantized x. Remove the per-ticket overlay raster from this path.
4. **Keep the full row unchanged** as the reference.

## Gates, in order

| Gate | Where | Pass |
|---|---|---|
| G1 mobileLarge, gold dab ticket | iPhone, deployed | Optimized row vs its live DOM: no displacement at ¼ device px. Shared-edge softness like `9.` allowed; any 1 px shift fails. |
| G2 same | Chrome DPR 2 and 3 | Stamped id and amount byte-identical to the overlay run (as `$1,509.31` was) |
| G3 all 5 presets × 3 faces | iPhone + Chrome DPR 2/3 + Mac WebKit DPR 3 | G1/G2 criteria on every region |
| G4 1,000 tickets | Chrome + iPhone | Capture count after warm-up stays flat as tickets are added (zero new rasters per ticket); report warm-up time and per-ticket stamp time |

Run each gate with `scripts/iphone-compare/` (`f0.mjs` for capture, `analyze.py` for displacement). Every result canvas used for evidence must be a whole number of CSS px.

## Not in scope

- Groups 2–5 of the change stay closed (HTML-text painter).
- The catalog (group 6) starts only after G4 passes.
