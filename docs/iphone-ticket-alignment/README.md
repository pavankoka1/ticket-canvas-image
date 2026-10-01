# iPhone ticket alignment — evidence

Reference for change `fix-iphone-ticket-alignment`. Harness: `scripts/iphone-compare/`.

## Provenance

| Item | Value |
|---|---|
| Device | iPhone 16 Pro Max (iPhone17,2), physical, USB |
| OS | `devicectl`: OS Version 27.0, build 24A437. Safari UA string reports `iPhone OS 18_7` (UA is frozen; record both) |
| Browser | Mobile Safari, WebKit 605.1.15, driven by `safaridriver` (macOS) |
| DPR | 3 (`devicePixelRatio`), `activeDpr()` 3 |
| Viewport | 440 × 796 CSS px, page zoom 1 |
| `devicePixelContentBox` | unsupported on this WebKit (probe records `null`); canvas buffers are `round(css × 3)` |
| App commits | Experiments F0–S9 ran on `5b4c7cc`. F0 reproduction ran on `702edbf` (only change in `src/`: Compare default blend → `difference`; harness forces `normal` per capture) |
| Mac regression engines | Playwright WebKit build 2248 (`playwright-core` 1.58.0); Google Chrome with `--force-device-scale-factor` |

## Raw captures

Stored outside source control: `~/bingo-iphone-evidence/` (≈ 63 MB). Integrity: `~/bingo-iphone-evidence/SHA256SUMS` (2,329 files, `shasum -a 256 -c SHA256SUMS`).

| Directory | Experiment | Notes |
|---|---|---|
| `f0-iphone/` | F0 baseline, 180 PNG + 5 probe JSON | 3 repeats identical (max Δ 0) |
| `f0-repro/` | F0 rerun with committed harness | **180/180 PNG byte-identical to `f0-iphone/`** |
| `f3-iphone/` | A/B/C/D, baseline correction | A = B = D pixel-identical |
| `s4-iphone/` | header gradient / overflow / radius | |
| `s5-iphone/` | amount hidden/empty, punctuation ladder, id swap | |
| `s6-iphone/` | badges, label, disc image, backgrounds, multiplier layers (S2) | |
| `s7-iphone/` | origin moved by transform | |
| `s8-iphone/` | origin moved by layout `top`/`left` | **causal** |
| `s8-sim/` | same on simulator | **invalid** — simulator screenshots misregistered (≈1.5 px offsets in clean regions) |
| `s9-iphone/` | original → whole origins → + F3 → original | |
| `probe-f0-desktopMedium.json` | canvas-dom-pixels probe + ancestor chain + cache keys | |

The analysis code used live during the session was inline; `analyze.py` is its committed form. Re-running it on `f0-iphone/` reproduces the reported F0 table, with one correction: the first inline pass used a grey-level gate and missed mobileCompact `c1`/`c4` (0, −0.25) disc fringes. They are present in F0 raw data, so the "cross-session disc discrepancy" was a metric artefact, not a session difference.

## Method

Same element, DOM-only then canvas-only screenshot, same scroll position, native 3× (image width = canvas buffer width). Fixed crops in shared coordinates; never re-centred on ink. Displacement = bilinear shift of canvas vs DOM minimising squared error, 0.25 device-px grid in ±2. "No displacement detected" means at that resolution, not absolute zero. The >32 colour gate only decides whether to search.

## Findings (physical phone)

| # | Finding | Evidence |
|---|---|---|
| 1 | Cells and discs: no displacement detected, except mobileLarge `58` (`5` only, (0.5, 0)) and mobileCompact disc fringe (0, −0.25) | F0 |
| 2 | Header id/amount drift is vertical only, +0.75…+2 device px | F0 |
| 3 | Header paint (gradient, `overflow`, `border-radius`) does not cause it | S4 |
| 4 | Header content (amount presence/punctuation, id string, colour) does not cause it | S5 |
| 5 | Badges, disc images, card/body backgrounds do not cause it | S6 |
| 6 | Moving the card by `transform` does not remove it | S7 |
| 7 | **Fractional effective layout origin causes it**: whole CSS-px layout origins clear desktopMedium/mobileLarge/mobileCompact headers; adding ⅓ CSS px to a clean card introduces it | S8 (both directions) |
| 8 | Residual +1 on desktopSmall and mobile is origin-independent; F3 (−1) clears mobile; desktopSmall F3 measures −0.5 and has no effect | F3, S9 |
| 9 | Multiplier F3 is unreliable (improves some presets, worsens desktopSmall/mobileCompact); whole origins alone clear desktopSmall/mobile multipliers | S9 |
| 10 | No single multiplier paint layer causes multiplier drift; rotation converts a vertical error into a small horizontal one | S2 (in S6) |

Status labels: whole origins are demonstrated for the **full row**; the optimized row remains a gate. Mobile header F3 is demonstrated in isolation; a shared implementation needs verification. desktopSmall, remaining multiplier drift, `58` and the disc fringe are investigations.
