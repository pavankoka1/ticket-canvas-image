# Design

## Context

See `proposal.md` for motivation and scope. This design is based on current source inspection and the user's reported physical-phone experiments; the proposal-writing session did not run the phone harness or inspect its raw captures.

Current `/compare` uses `CompareSvgStack`, with `rasterizeCompareTicketSvg` for the full row and `assembleCompareSprites` for the reusable row. `align()` writes DPR-derived fractional `left`/`top` on each commit and on resize notifications. Capture starts in another layout effect without a named alignment-ready contract. HTML zoom scales the cloned ticket inside the SVG image; the full path has no F3 header correction. Older Range-centre calibration in the file is not a replacement for the demonstrated baseline-marker experiment.

Reusable number/badge packs warm in an offscreen host at `left:-10000px;top:0`; chrome and header captures use the live ticket. ID digit placement uses horizontal Range measurements and phase keys. These are different capture sources: do not assume every old sprite was captured at a fractional origin. `sprites` and `packs` are module maps; persisted records share `bingo-cell-atlas` / `atlases` with other artwork and currently use `compare-sprites-v16` keys.

The catalog actually calls `paintCatalogTicket` from `CanvasPool.paintTile`. AGENTS.md incorrectly describes the current Compare path and also calls this catalog painter unused. Its buffer-sizing summary differs from the current edge-based tile sizing implementation. Those discrepancies must be documented accurately; this alignment change must not silently revert the existing buffer behaviour.

### Evidence ledger at proposal time

| Finding | Status and limits |
| --- | --- |
| Whole layout origins remove full-row header drift on desktopMedium, mobileLarge, mobileCompact | Reported iPhone S8 and combined-run evidence, including reverse interventions; not yet verified in the optimized row |
| Mobile headers retain +1 device px at whole origins; measured F3 of -1 removes it | Reported full-row experiment only; shared integration remains a gate |
| desktopSmall headers retain +1; measured -0.5 has no effect | Open investigation, not a zero correction and not a usable fix |
| Multiplier F3 sometimes worsens alignment | Excluded from the implementation candidate, including disabled labels |
| Whole origins clear some multipliers, but others retain drift | Track desktopMedium, mobileLarge and mobileCompact separately |
| mobileLarge `5` in `58`, mobileCompact disc fringe | Open glyph/softness classification; removing an image alone does not prove resampling |
| Header gradient/clip/radius substitutions did not remove header drift | Reported S4 evidence; fallback-font explanations were hypotheses, not established causes |

The scratchpad identifiers are `f0-iphone`, `f3-iphone`, `s4` through `s9-iphone`, and associated `.mjs` scripts. Their absolute paths, exact iOS/browser versions and complete raw results must be recovered in task 0. Missing artifacts must be reported, not reconstructed as measured results. The original F0 report described 180 screenshots: five presets, two rows, three ticket states, three repeats, DOM and canvas separately.

## Goals / Non-Goals

**Goals:**
- Separate layout coordinates from visual transforms and device-pixel raster coordinates without changing ticket sizing.
- Make font readiness, alignment, measurement, calibration and capture ordered and inspectable for both cold and warm caches.
- Apply measured and validated header corrections in one clone pipeline, retaining sprite reuse and avoiding per-ticket calibration overhead.
- Provide an evidence ledger that distinguishes fixed geometry, residual softness, and unresolved movement.

**Non-Goals:**
- No replacement of HTML zoom with SVG scaling, 1x capture or another renderer; no new DPR cap or paint-time reads of raw devicePixelRatio.
- No blanket integer rounding of every CSS length, manual per-device nudges, or correction of multiplier text through the header mechanism.
- No whole-ticket catalog capture, revived unused bake pipeline, redesign, routing change, or animation redesign.
- No claim that quarter-device-pixel search proves absolute pixel identity across every browser/device.

## Decisions

### 1. Preserve and reproduce evidence before implementation

Import reusable scripts into a developer-only `scripts/iphone-compare/` area and concise manifests/results into `docs/iphone-ticket-alignment/`. Preserve raw captures at stable documented locations with checksums; avoid adding all binary screenshots to source control by default. Record the exact command, runtime dependencies, source commit, ticket strings, device/OS/browser versions, viewport/scroll/zoom, font readiness, cache identity and repeat count. Keep any device identifiers or session endpoints out of committed fixtures.

The harness must run the unchanged F0 matrix before testing a fix. Reconcile cross-session differences, including the disc fringe, instead of changing the pass threshold. Record the required `canvas-dom-pixels` probe before any pixel-code edits, including unavailable device-content-box data explicitly. Scripts perform bulk image analysis; reports expose concise tables and representative failures.

Alternative rejected: rebuilding scripts from prose or trusting the app's canvas-versus-canvas counter. Neither preserves the original measurement chain.

### 2. Establish layout origins before capture

In `/compare`, bind the live ticket and resolve fonts/geometry, establish its whole CSS-pixel effective layout origin, verify the resulting layout, then measure/capture. Account for ancestor layout positions and CSS zoom; preserve a fractional visual remainder in a translation shared by the DOM and canvas wrapper. An integer local offset or transformed `getBoundingClientRect()` alone is insufficient evidence.

Represent capture readiness with an explicit layout generation or equivalent ordered contract, not a guessed timeout. Preset, viewport or relevant font/layout changes invalidate readiness and pending work. Revalidate before measurements following asynchronous pack/font work, and before publishing a ready canvas; stale generations must not publish or seed keys for newer geometry. Ensure repeated commits and resize callbacks do not create an alignment/repaint loop. Logs identify generation, origins, transforms, zoom and capture start so cold-load ordering is verifiable.

Preserve the current backing-store policy. The first gate is the origin-only phone matrix against each row's own DOM, including fresh and warm assets. Optimized output need not reproduce the full row's residual errors; better DOM agreement is valid. No new cell/disc/multiplier discrepancies are permitted.

Alternative rejected: snapping only to device pixels or repairing the final rectangle with a transform. The reported phone experiment demonstrates sensitivity to layout-origin fractions. The implementation must address that layer.

### 3. Version capture compatibility, not shared storage

Introduce a new comparison cache revision for origin behaviour and another compatibility revision when header correction is enabled. Include the validated calibration identity and relevant font/style/layout/DPR inputs so corrected and uncorrected header assets cannot alias. Reuse that identity across persistent records, in-memory maps and derived ink patches. Recompute runtime calibration when its inputs change; do not treat a browser brand string as sufficient calibration provenance.

Use new namespaces and a fresh page context for cold runs. Warm runs verify actual cache reuse. If old data needs cleanup, target only the selected compare prefix in `atlases`; do not delete the shared database/store. Restore reports state whether assets were retained or regenerated.

Alternative rejected: deleting IndexedDB alone, which leaves module maps alive and erases evidence of capture timing if done without a manifest.

### 4. Share one validated header calibration path (superseded, see 7)

Use the baseline-marker method from the preserved F3 harness, remeasured after origin normalization for the actual font, meta size, line height, header geometry and capture ratio. Verify the marker does not alter the measured layout. In-page zoom is a calibration model; decoded SVG versus phone DOM remains its validation. Do not substitute a Range rectangle centre or infer glyph font identity from `document.fonts.check()`.

Pass an explicit typed calibration result into the shared raster path. Apply the approved ID/amount translation to the clone exactly once, before SVG serialization and any cropping. Keep the live DOM untouched. Ensure cached source SVGs and derived ink-patch decoding preserve the applied correction without applying it again. Calibration is shared per compatible style/layout, not repeated for every catalog ticket.

Enable only corrections whose measured prediction has passed the phone gate: initially mobile headers, with zero change for passing presets. desktopSmall's -0.5 remains unvalidated and must not be applied merely because the probe returned it. Unavailable or unvalidated calibration must remain diagnosable, not become a guessed constant. Multiplier nodes are excluded entirely.

Alternative rejected: global -1 adjustments, multiplier F3, or a platform-name conditional pretending that all iPhones have identical rounding.

### 5. Keep remaining issues as bounded investigations

- **desktopSmall:** With whole origins, explain why the marker predicts -0.5 but decoded glyphs remain +1. Compare marker placement, actual text runs and decoded glyph rows for the 11px-font/15px-header case. Separate measurement error from a paint rounding threshold before proposing a fix.
- **Multipliers:** Measure the label's own baseline/rotation coordinates for solid and gold variants at the remaining presets. Reproduce the failed F3 controls and test line construction and rotation without assuming a single gradient layer is responsible. Do not re-enable the rejected blanket correction.
- **`58`:** Compare `5` and `8` independently at shared coordinates to distinguish movement, glyph shape and sampling phase.
- **Disc:** Resolve cross-session setup differences; classify the fringe with independent position and residual-image evidence. Edge softness is acceptable only when geometry, position and clipping are unchanged.

Each investigation produces a minimal reproduction, causal evidence, disposition and a candidate-specific gate. Do not mark unresolved displacement as fixed. Any remedy that changes the agreed architecture or scope requires updating the change before implementation; the task list does not pre-authorize arbitrary renderer changes.

### 6. Port verified behaviour to the catalog last

After the comparison gates and investigation dispositions are recorded, extend the origin contract to the ticket frame, tile host, capture hosts and pooled cards. Carry compatible header calibration into `catalogPaint`, `headerGlyphs` and `cellBitmaps` as appropriate to their actual paths; preserve their reusable cells/digits/amounts and the existing activeDpr policy. Check the current edge-based CanvasPool sizing against the required probe rather than replacing it from stale documentation.

Validate settled DOM/canvas handoffs, short-row centring, scroll/tile boundaries, resize, adds and draw/sort gestures. Exercise 1,000 tickets and compare capture counts/warm-cache reuse with baseline; calibration must not introduce work proportional to every ticket. Keep known unresolved cases explicit rather than claiming catalog parity means universal perfection.

### 7. Revised direction (2026-10-02): SVG text replaces the HTML-text painter

Header calibration (decision 4) was removed after it failed on the phone and regressed Chrome at DPR 2: in-page zoom probes do not predict the SVG image's text layout. The `/compare` mode "SVG text: all" draws id, amount, cell numbers and multiplier (disc + label) as one SVG overlay anchored at the card's whole-pixel origin, at numeric coordinates, identically in the live DOM and the raster clone. It shows no displacement at quarter-device-pixel resolution in Chrome DPR 2/3 and Mac WebKit DPR 3, and the user verified it on M1 Pro, M4 Pro, iPhone 16 Pro Max and iPhone 13.

That overlay is the reference painter. It rasterizes once per ticket, so it does not scale to 1,000 tickets. The scalable painter is a cached SVG-glyph atlas, captured on the card's pixel grid (card-origin SVG, glyph at its real coordinate, overlay zoom, then cropped) and stamped at positions read from the live `<text>` (`getStartPositionOfChar`):

- cell numbers 1–60: one sprite per fill (integer column pitch, no phase variants);
- multiplier labels: one whole sprite per value and face; disc stays the PNG;
- id digits: per digit × measured sub-pixel phase × fill;
- amounts: whole-string sprites while payouts are a small set.

The baseline's fractional device y is baked into each sprite, not snapped. The atlas is built only after three phone checks pass: (A) a stamped "58" matches the overlay; (B) the number of distinct renderings of one digit across 1/16-px offsets (atlas width); (C) the seam of "10" stamped as two glyphs vs one sprite.

## Risks / Trade-offs

- Layout rounding depends on environment → Gate on the actual iPhone; record versions and keep Mac/Linux regressions. DPR emulation supplements but does not establish phone acceptance.
- Adding a readiness contract can race resize or starve capture → Use generation cancellation and focused cold-load/preset-change checks with capture-order logs.
- Origin changes can interact with catalog transforms/FLIP → Port only after compare gates and verify gestures at settled frames without overwriting animation transforms.
- Baseline probes may change layout or fail to predict SVG image paint → Validate probe neutrality and retain the decoded-image phone comparison as authority.
- Metrics may mistake softness for displacement → Report per-region/per-glyph offsets, absolute positions and residuals; no sole centroid or >32 threshold pass rule.
- Evidence may be unavailable or differ across sessions → Task 0 is an implementation prerequisite; record gaps and reproduce before claiming a fix.

## Migration Plan

Implement in the task order: harness and baseline, compare origins, compare header calibration, scoped investigations, catalog port, documentation. Keep origin-only and origin-plus-calibration evidence distinct. Verify five presets × three states × two rows with three repeats and restoration controls, then cold/warm cache paths and desktop regressions. Run lint/build after code changes; add focused tests only for meaningful capture-order/cache/calibration invariants.

Rollback the affected renderer change and its cache policy together, reload to reset module caches, and report which assets regenerate. Do not reuse corrected blobs with uncorrected placement or clear unrelated persistent data. Do not archive this change or claim all-presets success while an applicable acceptance gate is unresolved.

## Open Questions

- Exact scratchpad paths, iOS/browser versions and harness runtime dependencies will be recovered from experiment manifests in task 0; no values are invented here.
- desktopSmall, residual multipliers, `5` and disc mechanisms remain the explicitly scoped spikes above. Their results determine a bounded remedy or an explicit unresolved disposition, not an assumed solution.
