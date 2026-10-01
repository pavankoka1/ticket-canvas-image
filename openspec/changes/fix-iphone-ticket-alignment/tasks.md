# Tasks

Planning only: all tasks remain unstarted. Groups preserve the agreed 0–7 order. The phone matrix is five presets × three ticket states × two rows, each canvas measured against its own DOM; desktop emulation is supplementary. Do not advance a renderer change past a failed prerequisite gate.

## 0. Evidence and harness first

- [x] 0.1 Recover the `f0-iphone`, `f3-iphone`, `s4`–`s9-iphone` scripts and results; verify an inventory with actual paths, hashes and missing-artifact disclosures before relying on reported measurements.
- [x] 0.2 Import reusable capture/analysis scripts into `scripts/iphone-compare/` and tables/manifests into `docs/iphone-ticket-alignment/`; verify documented commands, dependencies, commit, iOS/browser versions and stable raw-capture references are present and reproducible.
- [x] 0.3 Run the unmodified F0 matrix with three repeats and shared native-resolution crops; verify repeatability and reproduction of reported findings, documenting and resolving cross-session discrepancies before rendering edits.
- [x] 0.4 Record the required canvas-dom-pixels probe, ancestor transforms/zoom, layout and visual coordinates, and cache state; verify the harness distinguishes transformed rectangles from layout origins and reports search resolution and per-glyph residuals.

## 1. Compare origins and capture ordering

- [ ] 1.1 Establish whole effective CSS-pixel layout origins in `compareSvgStack.tsx`, with the visual remainder shared after layout; verify original → whole-origin → restored captures, unchanged dimensions and the ancestor-origin diagnostics.
- [ ] 1.2 Make font/alignment readiness an explicit prerequisite for measurements and both capture paths, including asynchronous pack warming; verify cold start, preset changes and resize with logs or focused tests showing that stale generations neither publish ready canvases nor populate incompatible cache keys.
- [ ] 1.3 Version the compare origin policy across persistent records, module maps and derived patches; verify old `compare-sprites-v16` entries are bypassed, cold/warm results agree and unrelated `bingo-cell-atlas` records are preserved.
- [ ] 1.4 Run the physical-phone origin-only matrix for both rows; verify desktopMedium/mobileLarge/mobileCompact headers clear, no new cell/disc/multiplier discrepancies appear, and residual mobile/desktopSmall behaviour is recorded without requiring optimized output to copy full-row errors.
- [ ] 1.5 Record the origin implementation and gate results, run `npm run lint` and `npm run build`, and perform available Mac/Linux regression captures; verify failures or unavailable environments are explicit and do not substitute for the phone gate.

## 2. Shared header-only F3

- [ ] 2.1 Port the preserved baseline-marker measurement into a typed calibration result after normalized layout; verify marker neutrality, compatible-style reuse, mobile prediction and explicit exclusion of ineffective desktopSmall/multiplier measurements.
- [ ] 2.2 Add one clone-only ID/amount correction point to `rasterizeCompareTicketSvg`, shared by full and partial captures; verify decoded full images, cropped headers and derived ink patches apply it once while live DOM and multiplier nodes stay unchanged.
- [ ] 2.3 Extend cache compatibility with header-calibration revision and relevant measured inputs; verify correction changes cannot reuse old header blobs/source SVGs or double-apply shifts on warm reload.
- [ ] 2.4 Run original → origins-only → origins-plus-header-F3 → restored phases on the phone; verify mobile headers clear for all three states in both rows, the other passing presets retain their results, and desktopSmall remains explicitly unresolved if still displaced.
- [ ] 2.5 Document calibration limits and cold/warm gate results; verify focused calibration/cache checks, lint/build and available desktop regressions pass before continuing.

## 3. desktopSmall header investigation

- [ ] 3.1 Isolate the 11px-font/15px-header case at whole origins with F3 off; deliver a reproduction comparing the -0.5 marker prediction with decoded glyph rows and live DOM, explaining whether the marker or paint rounding causes the discrepancy before proposing an offset.
- [ ] 3.2 Record a causal finding, bounded candidate and phone acceptance case, or an explicit unresolved disposition; verify any demonstrated remedy in both rows with fresh/warm assets and desktop regressions before marking the header fixed, updating this change if the remedy alters its scope.

## 4. Multiplier investigation

- [ ] 4.1 Reproduce solid and gold labels on desktopMedium/mobileLarge/mobileCompact at whole origins without multiplier F3; deliver label-specific baseline/rotation and line-layout measurements with layer-isolation controls and absolute positions.
- [ ] 4.2 Record the mechanism and a candidate-specific gate or unresolved disposition; verify a proposed remedy against both label types and all five presets, including previously improved desktopSmall/mobile, before implementing or declaring it fixed. Keep rejected blanket multiplier F3 disabled.

## 5. Glyph and disc classification

- [ ] 5.1 Analyse separate `5` and `8` crops in mobileLarge `58`; deliver shared-coordinate displacement and shape evidence that distinguishes glyph movement from raster differences, with a bounded follow-up gate if movement remains.
- [ ] 5.2 Reproduce mobileCompact disc fringes across sessions with matching manifests; deliver a movement-versus-softness classification supported by position and residual evidence, not merely disappearance when the image is removed.

## 6. Catalog port after comparison gates

- [ ] 6.1 Confirm groups 1–2 gates and groups 3–5 dispositions are recorded; then normalize ticket-frame, tile-host, pooled-card and capture-host origins, verifying the required probes and preserving existing animation transforms and buffer-sizing behaviour.
- [ ] 6.2 Port only verified origin/header behaviour through the actual `catalogPaint`, `headerGlyphs` and `cellBitmaps` paths with compatible cache identities; verify reusable cells/digits/amounts and that no whole-ticket bake path is introduced.
- [ ] 6.3 Run the phone catalog matrix across settled DOM/canvas handoffs, short rows, scroll/tile boundaries, resize, adds and draw/sort gestures; verify agreement with the validated Compare results, preserved DOM-band holes and explicit residual-case reporting.
- [ ] 6.4 Exercise 1,000 tickets and repeated amounts; record baseline-versus-change capture counts, calibration reuse and warm-cache behaviour, confirming no per-ticket full capture or calibration work. Verify lint/build and available Mac/Linux regressions.
- [ ] 6.5 Document the catalog origin contract, validation results and cache-aware rollback; verify rollback identifies retained/regenerated assets and leaves unrelated storage intact.

## 7. Architecture reconciliation and final acceptance

- [ ] 7.1 Update AGENTS.md to name the actual Compare full/sprite paths, correct the contradictory catalog painter and buffer descriptions, and document the origin-before-capture rule; verify every changed architecture statement against current source.
- [ ] 7.2 Document that DevTools DPR emulation is not physical-iPhone acceptance evidence; verify the phone harness instructions and links lead to the preserved scripts, provenance and result tables.
- [ ] 7.3 Publish the final integrated phone matrix and known-issue ledger, cross-checking both rows and catalog cold/warm runs; verify no unresolved displacement is labelled softness or all-presets success and no required gate is silently skipped.
