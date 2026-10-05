# iPhone compare harness

Developer-only. Measures each `/compare` canvas against its own live DOM on a physical iPhone through Safari WebDriver. Desktop DPR emulation is regression evidence only (see `docs/iphone-ticket-alignment/`).

## Setup (once)

- iPhone: Settings → Apps → Safari → Advanced → Web Inspector **on**, Remote Automation **on**. Auto-Lock **Never** during runs. Connect by USB, trust the Mac.
- Mac: Safari → Settings → Advanced → Show features for web developers. Run `safaridriver --enable` once.
- Python 3 with `numpy` and `Pillow`; Node ≥ 20 (uses built-in `fetch`).

## Run

```bash
npm run dev -- --host                # phone must reach the dev server
safaridriver -p 4444                 # second terminal
export IPHONE_UDID=<udid from: xcrun devicectl list devices>
export COMPARE_URL=http://<mac-lan-ip>:5173/compare
OUT=$HOME/bingo-iphone-evidence/<run> node scripts/iphone-compare/experiments/f0.mjs
python3 scripts/iphone-compare/analyze.py $HOME/bingo-iphone-evidence/<run> [--glyphs]
OUT=$HOME/bingo-iphone-evidence/<run>-probe.json [PRESET=mobile] node scripts/iphone-compare/probe.mjs
```

Keep the phone unlocked and untouched while a run is active.

## Files

| File | Role |
|---|---|
| `experiments/f0.mjs` | Baseline: 5 presets × 2 rows × 3 tickets × 3 repeats, DOM-only and canvas-only element screenshots, layout probe per preset |
| `experiments/f3.mjs` + `inject-body.js` | Phases A (app) / B (hand FO, uncorrected) / C (hand FO + baseline correction) / D (reload) |
| `experiments/s4.mjs` … `s9.mjs` | Header paint, header content, badges/backgrounds + multiplier layers, transform origin, layout origin, origin + F3 experiments |
| `analyze.py` | Fixed-crop displacement analysis (0.25 device-px bilinear search), per-glyph option |
| `probe.mjs` | canvas-dom-pixels probe, ancestor transform/zoom chain, compare cache state |
| `golden.mjs` | Canvas golden capture/compare at DPR 2 and 3 (`svg-all`, all presets) |
| `domcv.mjs` | Chrome DOM-vs-canvas stacks per preset; cold + warm; runs `analyze.py` |
| `perf.mjs` | Production preview timing (cold IDB clear + reload); logs `[atlas-warm]` |

Experiment scripts are preserved as run; they mutate the page at runtime only. Raw captures are not committed; see the manifest for their location and checksums.
