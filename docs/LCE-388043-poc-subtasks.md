# LCE-388043 — Ticket canvas bitmap cache POC · subtask catalog

**Parent Jira:** [LCE-388043](https://pragmaticplay.atlassian.net/browse/LCE-388043)

**Live POC (cross-reference in every subtask):**

- Catalog: [https://ticket-canvas-image.vercel.app/](https://ticket-canvas-image.vercel.app/)
- Compare lab: [https://ticket-canvas-image.vercel.app/compare](https://ticket-canvas-image.vercel.app/compare)

**Repo:** `ticket-canvas-image` · architecture source: `AGENTS.md`

**Outcome:** Hybrid catalog — live DOM for the near-viewport band and gestures; tiled canvas for scrolled-away tickets. Production paint path: **svg-all** atlas (`paintCatalogTicketSvgAll`). `/compare` documents every rejected and adopted render experiment.

---

## How to use this in Jira

Create each item below as a **Sub-task** of LCE-388043. Suggested labels: `ticket-canvas-poc`, `compare-lab`, `canvas-atlas`. Paste the **Verification** block into Description; set **Done** when criteria match deployed Vercel + repo.

---

## A · Architecture & catalog (hybrid DOM + canvas)

### LCE-388043-01 · Hybrid catalog architecture (DOM pool + tiled canvas underlay)

**Summary:** Deliver Fortunamania-scale ticket catalog with DOM for visible rows and canvas for off-screen tickets.

**Work:** `TicketCatalogController`, `DomPool` (80 cards), `CanvasPool` tiled underlay (~70 tickets/tile; 20 when DPR ≥ 3), `MAX_TICKETS`, scrollport `setViewport` / `primeViewport` / `followViewport`.

**Verification:** On [POC home](https://ticket-canvas-image.vercel.app/) — add +25/+100, scroll fast: DOM count bounded; no blank canvas rows after scroll settles.

---

### LCE-388043-02 · Retire per-ticket DOM bake / worker crop cache

**Summary:** Document and isolate unused per-ticket capture pipeline; standardize on cell + compare atlases.

**Work:** `_legacy/` (`bakeQueue`, `bitmapCache`, `DomCaptureStage`, `BakeCropClient`, `bakeCrop.worker`) marked dead in `AGENTS.md` and `_legacy/README.md`.

**Verification:** No imports from `_legacy/` in live catalog path; grep clean except README.

---

### LCE-388043-03 · Vanilla catalog shell (no React on `/`)

**Summary:** Home route mounts `mountTicketCatalog()` without React Router; font gate before first paint.

**Work:** `src/main.tsx`, `src/ticketCatalog/index.ts`, `ensureTicketFont`, no `StrictMode` (SnapDOM double-fire).

**Verification:** `/` has no React root; Compare remains React at `/compare`.

---

### LCE-388043-04 · Fortunamania ticket tokens & frame geometry

**Summary:** Mirror production ticket CSS presets and catalog frame bands in POC.

**Work:** `ticketPresets.ts` (`resolveTicketMetrics`), `applyTicketCssVars`, desktop 1001×231 frame, mobile band overrides in `GameGrid.module.css` / layout.

**Verification:** All six presets on [Compare](https://ticket-canvas-image.vercel.app/compare) match FM breakpoints.

---

### LCE-388043-05 · DOM band, skipIds, and post-scroll tile sync

**Summary:** Prevent double-paint: canvas skips tickets in live DOM band; repaints holes after scroll.

**Work:** `computeDomBand`, `DomPool`, `CanvasPool.setSkip` / `syncDom`, blank band on canvas during dab/FLIP.

**Verification:** During draw dab on visible cards, no canvas ticket visible under DOM; after scroll to top, canvas fills former band.

---

### LCE-388043-06 · Ball draw, dab, sparkle, FLIP shuffle on DOM pool

**Summary:** Reproduce FM draw gesture and post-round shuffle on visible DOM only.

**Work:** `drawGesture.ts`, `drawPhase.ts`, `sortTickets` / `resolveShufflePlan`, `DomPool.playMoves`, `endRound` gold/green; off-screen state on canvas at settled frame.

**Verification:** Six-ball round with multipliers on balls 3/5/6; shuffle when scrolled to top; gestures not cancelled by FLIP (translate vs scale split).

---

### LCE-388043-07 · Canvas tile memory retention & cooperative repaint

**Summary:** Bound iOS Safari canvas memory; repaint released tiles as viewport returns.

**Work:** `CANVAS_TILE_RETAIN_BYTES` (48MB), coldest tile eviction, `followViewport` one tile/frame, resize drops tiles before repaint.

**Verification:** Long scroll on iPhone Safari — no persistent blank stripes; `[tile]` behavior per `CanvasPool.ts`.

---

## B · `/compare` lab & render-mode experiments

### LCE-388043-08 · Compare page: difference-blend DOM vs canvas harness

**Summary:** Build `/compare` regression UI with opacity, blend modes, preset + render-mode switches.

**Work:** `Compare.tsx`, `compareDomAlign`, three fixture tickets (normal, dab+win, disabled).

**Verification:** [Compare](https://ticket-canvas-image.vercel.app/compare) — difference blend at overlay 1.0; black = pixel match.

---

### LCE-388043-09 · Render mode: HTML zoom · display DPR (foreignObject baseline)

**Summary:** Baseline capture: HTML layout zoomed to canvas backing store at `activeDpr()`.

**Work:** `compareRenderMode` `html`, `compareRasterRatio`, `CompareSvgStack` full-ticket blob row.

**Verification:** Mode **HTML zoom · display ratio** — documents baseline drift vs DOM on Linux/Windows.

---

### LCE-388043-10 · Render mode: fixed raster ratios (1, 2, 2.5, 3)

**Summary:** Study intentional softness when canvas CSS size fixed but capture ratio lowered.

**Work:** `ratio-1` … `ratio-3` in `COMPARE_RENDER_MODES`.

**Verification:** Switch each ratio on Compare; canvas visually softer when N < device DPR.

---

### LCE-388043-11 · Render mode: SVG-text multiplier (`svg-mult`)

**Summary:** Multiplier label as explicit SVG coordinates in DOM and raster clone.

**Work:** `compareSvgMultiplier.tsx`, `usesSvgMultiplier`.

**Verification:** **SVG-text multiplier** mode — multiplier ink matches DOM; header/cells still HTML path.

---

### LCE-388043-12 · Render mode: SVG overlay full ticket (`svg-all`, recommended)

**Summary:** Header id/amount, cell numbers, multiplier disc as SVG overlay; shared with catalog paint.

**Work:** `compareSvgText.ts`, `usesSvgText`, `paintSvgAllCompareTicket`, default toolbar mode on `/`.

**Verification:** **SVG overlay · full ticket** — reference row for atlas-build-plan; catalog uses same warm pack.

---

### LCE-388043-13 · Compare diagnostics & pixel probe export

**Summary:** On-device evidence JSON for DPR, canvas backing store, typography rects.

**Work:** `compareDiagnostics.tsx`, `scripts/iphone-compare/probe.mjs`, `.cursor/skills/canvas-dom-pixels`.

**Verification:** Open diagnostics on Compare after paint; console `Compare pixel probe`.

---

### LCE-388043-14 · Catalog Safari check row (tile paint vs FO capture)

**Summary:** Second compare block: same FO pipeline vs `paintCatalogTicketSvgAll` tile composite.

**Work:** `compareCatalogTileStack.tsx`, visible when `svg-all`.

**Verification:** On Safari device, row 1 black; row 2 isolates tile-composite drift from capture drift.

---

### LCE-388043-15 · React native SVG → static markup → canvas (north-star recipe)

**Summary:** Prototype non-foreignObject path for future art (`svg-to-canvas` pattern).

**Work:** `reactSvgRaster.ts`, `compareReactSvgRecipe.tsx`, `MultiplierBadgeSvg.tsx`.

**Verification:** Compare recipe row — live `<svg>` vs cached canvas from `renderToStaticMarkup`.

---

### LCE-388043-16 · Legacy compare row: sprite-blit `paintCatalogTicket`

**Summary:** Preserve DOM + atlas sprite stack for alignment with restore-catalog branch.

**Work:** `compareSpriteStack.tsx`, `catalogPaint.ts`, `paintTicket` from `CanvasPool`.

**Verification:** Stack still available in codebase for sprite-blit regression (see `AGENTS.md` Compare table).

---

## C · Capture, atlases & svg-all composite paint

### LCE-388043-17 · foreignObject ticket SVG capture pipeline

**Summary:** Self-contained SVG + embedded assets → canvas decode for compare and warm sheets.

**Work:** `ticketSvgRaster.ts` — `rasterizeCompareTicketSvg`, `decodeCompareSvgBlob`, mechanism-B ink probe, white unmatted sprites.

**Verification:** Full-ticket compare row captures without tainting canvas; PNG/SVG bytes for IDB documented in module.

---

### LCE-388043-18 · Compare warm pack: batched sheet captures & parallel groups

**Summary:** Warm reusable HTML/CSS sprites before paint; batch captures (numbers, badges, glyphs).

**Work:** `compareCachedSprites.ts` — `preloadComparePack`, parallel groups of three, v52 number/badge batches, `[atlas-warm]` timing logs.

**Verification:** Cold vs reload warm times on preview (`docs/iphone-ticket-alignment/compare-baseline-v49.md`).

---

### LCE-388043-19 · Cell number atlas (balls 1–60) via real ticket cell SnapDOM

**Summary:** Per-layout vertical sprite sheet; geometry + inkShift in stored meta.

**Work:** `cellAtlas.ts`, `cellNumberSnap.ts`, `cellSpriteInk.ts`, capture from live `.ticketCard__cell`.

**Verification:** Canvas cell numbers match DOM on Compare svg-all; `[YDRIFT]` / sprite-over-DOM toggles per checklist.

---

### LCE-388043-20 · Badge, dab, disc & multiplier host atlases

**Summary:** Bitmap chrome for hit states and multiplier discs independent of per-ticket raster.

**Work:** `badgeAtlas.ts`, `compareSvgMultiplier` assets, `warmSvgAllHostBadgeBitmaps` / multiplier hosts in `compareSvgAllPaint.ts`.

**Verification:** DAB ticket on Compare shows dab, disc, multiplier label aligned in optimized composite.

---

### LCE-388043-21 · Header id & win amount SnapDOM sprites (replace fillText)

**Summary:** Whole-string header sprites with DOM edge-aligned shiftX/Y; IDB + RAM cache.

**Work:** `idDigitAtlas.ts`, `headerGlyphs.ts`, Range ink measurement, `[compare:probe]` logging.

**Verification:** Header id/win on canvas match DOM across Mac/Linux/Windows (no OS `fillText` drift).

---

### LCE-388043-22 · Header glyph phase atlas (per-char stamped sprites)

**Summary:** Chromium quarter-pixel and WebKit half-pixel phase sprites for header overlay text.

**Work:** `compareGlyphAtlas.ts`, `compareGlyphEngine.ts`, `measureHeaderGlyphDeviceXsBatch` for catalog tiles.

**Verification:** Optimized row byte-match vs full row on Chrome; phone displacement gates in `atlas-build-plan.md`.

---

### LCE-388043-23 · svg-all composite paint (compare optimized + catalog tiles)

**Summary:** Single composite: chrome FO, padded badge-body bands, number patches, stamped glyphs.

**Work:** `compareSvgAllPaint.ts`, `assembleCompareSprites` in `compareCachedSprites.ts`.

**Verification:** `canvasPixelDiagnostic` reports **0 pixels** vs full reference on svg-all optimized path (desktop).

---

### LCE-388043-24 · Catalog production paint: `paintCatalogTicketSvgAll`

**Summary:** Wire warmed compare pack into `CanvasPool` tile paint as primary path.

**Work:** `catalogSvgPaint.ts`, `warmCatalogCompareAtlas`, hidden measure card for batch header glyph X.

**Verification:** Home catalog at [POC](https://ticket-canvas-image.vercel.app/) with toolbar hint "svg-all sprite paint"; tiles paint off-screen tickets.

---

## D · IndexedDB, PNG persistence & web workers

### LCE-388043-25 · Catalog cell atlas IndexedDB (`bingo-cell-atlas`)

**Summary:** Persist 60 PNG blobs + geometry per layout cache key.

**Work:** `atlasStore.ts` — `loadAtlas` / `saveAtlas` / `loadSprites` / `saveSprites`, DB version 2.

**Verification:** Reload POC — warm skip SnapDOM when IDB hit (`[atlas:id] src: idb` in console).

---

### LCE-388043-26 · Compare warm-sheet IndexedDB & schema versioning

**Summary:** Persist compare glyph/badge/number sheets; bump version on capture semantic change.

**Work:** `compareCachedSprites.ts` `COMPARE_ATLAS_VERSION`, validation + recapture on corrupt sheets.

**Verification:** Clear site data → cold warm; second load → `[atlas-warm]` skip captures (C4).

---

### LCE-388043-27 · Compare warm optimizations C0–C5 (IDB defer, dedupe, parallel encode)

**Summary:** Production-ready warm: baseline harness, dedupe races, defer IDB writes, skip when warm, PNG worker.

**Work:** Commits C0–C5 series — `comparePersistEncode.worker.ts`, parallel sheet groups, `waitCompareAtlasPersist`.

**Verification:** `perf.mjs` reload ~930ms vs cold ~7s (v49 baseline doc).

---

### LCE-388043-28 · Web worker: sprite decode (`spriteDecode.worker`)

**Summary:** Off-main-thread PNG/SVG decode for atlas loads with main-thread fallback.

**Work:** `spriteDecodeClient.ts`, `spriteDecode.worker.ts`.

**Verification:** Atlas load does not block scroll; worker used when supported.

---

### LCE-388043-29 · Web worker: atlas normalize (`normalize.worker`)

**Summary:** Normalize captured sprite sheets off main thread with sync fallback.

**Work:** `normalizeClient.ts`, `normalize.worker.ts`.

**Verification:** Warm path uses worker batch; fallback on worker failure.

---

### LCE-388043-30 · Web worker: compare warm PNG encode (`comparePersistEncode.worker`)

**Summary:** PNG-encode warm canvases via OffscreenCanvas in worker; Safari main-thread encode fallback.

**Work:** `comparePersistEncode.worker.ts`, `comparePersistEncodeClient.ts`.

**Verification:** IDB stores PNG bytes; iOS uses reliable main-thread path where worker blob fails.

---

### LCE-388043-31 · PNG blob pipeline for untainted IDB storage

**Summary:** Prefer PNG in IDB; SVG pack fallback when encode fails; `bitmapToPngBlob`.

**Work:** `ticketSvgRaster.ts` encode helpers, `idDigitAtlas` PNG data-URLs for compare download.

**Verification:** IDB records validate as PNG; no tainted canvas persist.

---

## E · DPR, layout snap & cross-browser alignment

### LCE-388043-32 · DPR cap & integer CSS cell geometry

**Summary:** Single `activeDpr()` = round(devicePixelRatio) capped at 4; no duplicate caps in paint.

**Work:** `cellBoxModel.ts`, `ticketCellGeometry.ts`, `snapCss`.

**Verification:** Compare status line shows raster DPR; canvas backing = round(css × activeDpr()).

---

### LCE-388043-33 · Catalog frame & card origin snapping (Blink vs WebKit)

**Summary:** Remove subpixel lane drift without transform hacks on cards.

**Work:** `catalogOriginSnap.ts` — `snapCatalogFrameOrigin`, `snapLayoutOrigin`.

**Verification:** iPhone S7/S8 alignment OpenSpec evidence; no transform fix on lane.

---

### LCE-388043-34 · Runtime FM text baselines from measured CSS module copy

**Summary:** Header/cell/multiplier baselines from hidden measured ticket, not magic em constants.

**Work:** `ticketTextBaselines.ts` / `resolveTicketTextBaselines`.

**Verification:** Baselines part of compare pack cache key; stable across presets.

---

### LCE-388043-35 · iOS / Safari canvas stability (drift, scroll, resize)

**Summary:** Ship POC verified on iOS 13+ — no drift, smooth scroll, fast resize repaint.

**Work:** iOS fix commits; `scripts/safari-mobile-canvas-probe.mjs`, `safari-idb-reload-probe.mjs`.

**Verification:** Physical device on [Vercel POC](https://ticket-canvas-image.vercel.app/); compare row black on svg-all.

---

## F · Validation harness, deployment & documentation

### LCE-388043-36 · iPhone compare harness (Safari WebDriver + analyze.py)

**Summary:** Physical iPhone evidence for DOM vs canvas displacement per preset.

**Work:** `scripts/iphone-compare/` — `f0.mjs`, `g1-atlas.mjs`, `g2-chrome.mjs`, `analyze.py`, manifest JSON.

**Verification:** Runbook in `scripts/iphone-compare/README.md`; evidence under `docs/iphone-ticket-alignment/`.

---

### LCE-388043-37 · Golden compare baseline (v49) — zero pixel diff gate

**Summary:** Automated golden at DPR 2 and 3 for all presets, svg-all.

**Work:** `golden.mjs`, `domcv.mjs`, `compare-baseline-v49.md` — 60/60 frames 0 differing pixels.

**Verification:** `npm run build` + golden scripts against local or Vercel compare URL.

---

### LCE-388043-38 · Vercel deployment & public POC URL

**Summary:** Deploy production build for stakeholders and device testing.

**Work:** [https://ticket-canvas-image.vercel.app/](https://ticket-canvas-image.vercel.app/) linked from toolbar compare link.

**Verification:** Routes `/` and `/compare` load; fonts and atlas warm on cold visit.

---

### LCE-388043-39 · OpenSpec: iPhone ticket render alignment change

**Summary:** Formal proposal/spec/tasks for phone alignment gates (full vs optimized row).

**Work:** `openspec/changes/fix-iphone-ticket-alignment/`, `docs/iphone-ticket-alignment/atlas-build-plan.md`.

**Verification:** Spec distinguishes full-row reference vs optimized atlas gate; tasks 8.x tracked.

---

### LCE-388043-40 · Performance pass: catalog code optimization

**Summary:** Post-parity optimization for smooth catalog on mobile production preview.

**Work:** Commit `Code optimisation for performance`; controller/canvas pool hot paths.

**Verification:** Profiling on iOS — add/scroll/draw within FM UX expectations on Vercel build.

---

## Parent ticket description (suggested update)

**Objective:** Prove hybrid DOM + tiled canvas can render 1000+ Fortunamania tickets with pixel parity to live DOM for off-screen paint, using reusable atlases instead of per-ticket bake.

**Deliverables:** Public POC ([ticket-canvas-image.vercel.app](https://ticket-canvas-image.vercel.app/)), Compare lab documenting all render experiments, svg-all atlas path in production catalog tiles, IDB-backed warm cache, cross-platform alignment evidence.

**Related:** Prior Money Ball POC [LCE-347250](https://pragmaticplay.atlassian.net/browse/LCE-347250); Confluence [Money Ball Ticket Approaches POC](https://pragmaticplay.atlassian.net/wiki/spaces/LE/pages/5677646110).
