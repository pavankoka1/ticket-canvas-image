# Proposal

## Why

On the user's iPhone 16 Pro Max, ticket header text and some multiplier/number glyphs drift between live DOM and canvas even when the full-ticket and reusable-sprite canvases agree. Controlled phone experiments support whole CSS-pixel layout origins and a limited mobile header correction; these need reproducible validation in both renderers before adoption in the catalog.

## What Changes

- Preserve the existing phone harness, analysis scripts, result tables and device/browser provenance before rendering changes; reproduce the reported F0 baseline.
- Establish whole CSS-pixel effective layout origins in `/compare`, with visual remainders applied through transforms, and explicitly await settled alignment before measuring or capturing.
- Keep HTML zoom as the capture approach. Introduce one shared, device-measured, clone-only header correction for full-ticket and reusable-sprite capture. Do not apply the unsuccessful multiplier correction.
- Version persistent and in-memory sprite identities when origin/correction behaviour changes; verify both cold and warm capture paths against each row's live DOM.
- Investigate desktopSmall headers, remaining multipliers, the mobileLarge `5` in `58`, and the mobileCompact disc fringe separately. Do not encode unexplained offsets or promise that these investigations already have fixes.
- After the comparison gates pass, port verified origin and header behaviour to the existing catalog sprite pipeline, preserving reusable assets and DOM-pool behaviour.
- Correct stale architecture documentation and document physical-device acceptance separately from DPR emulation regression checks.

## Capabilities

### New Capabilities

- `ticket-render-alignment`: Layout-origin, capture-order, header-calibration and reusable-cache behaviour that keeps DOM and canvas tickets aligned in comparison and catalog views.
- `ticket-render-validation`: Reproducible physical-device capture, displacement analysis, evidence retention and staged rendering acceptance.

### Modified Capabilities

None. The project currently has no published OpenSpec capabilities.

## Impact

Primary implementation areas are `compareSvgStack.tsx`, `compareCachedSprites.ts`, `ticketSvgRaster.ts`, and developer-only phone tooling/evidence. The later catalog phase covers `Catalog.tsx`, `DomPool.ts`, `CanvasPool.ts`, `catalogPaint.ts`, `headerGlyphs.ts`, `cellBitmaps.ts`, and relevant layout hosts. `atlasStore.ts` hosts shared persistent records; unrelated entries must remain intact. `AGENTS.md` requires reconciliation with the actual render paths.

No new renderer, DPR policy, application route, per-ticket catalog bake, or production dependency is proposed. Existing Mac/Linux output and the reusable approach for up to 1,000 tickets remain regression constraints. This change is staged: reported phone evidence is not a claim that the optimized row or catalog has already passed.
