# Compare baseline · v49 (`020264d`)

Recorded 2026-10-05 on Mac (Chrome harness + production preview). Golden lives in local `golden/` (gitignored); re-record with:

```bash
npm run dev -- --host 127.0.0.1 --port 5173
COMPARE_URL=http://127.0.0.1:5173/compare node scripts/iphone-compare/golden.mjs golden
COMPARE_URL=http://127.0.0.1:5173/compare node scripts/iphone-compare/golden.mjs --compare golden
```

## Gates (v49)

| Gate | Result |
|---|---|
| `npm run lint` / `npm run build` | pass |
| Golden DPR 2 + 3 cold compare | 60/60 frames · 0 differing pixels |
| `domcv.mjs` DPR 2 cold + warm | **dab tickets** on desktopSmall/mobile/mobileLarge report ≤1 device-px shifts in analyze (softness); normal/disabled rows clean. iPhone `g1-atlas` remains authoritative. |
| Production `perf.mjs` DPR 2 | cold **7468 ms** · reload **930 ms** |

### `[atlas-warm]` (production preview, `svg-all`, desktopMedium default)

**Cold** (IDB cleared): 123 captures / 1273 ms, 123 / 2278 ms, 20 / 3824 ms, 20 / 3742 ms (html-mult + svg-all packs on first paint — see C2).

**Reload**: 123 / 92 ms, 123 / 100 ms, 20 / 146 ms.

Dev-server cold for all presets is slower (~6.3 s reported historically); preview cold above is first-preset toolbar ready only.

## Harness scripts

| Script | Role |
|---|---|
| `scripts/iphone-compare/domcv.mjs` | Chrome DOM vs canvas stacks · asserts `svg-all` · cold IDB + warm reload |
| `scripts/iphone-compare/perf.mjs` | Preview timing + `[atlas-warm]` console lines |

## Pending (human)

- **Vercel**: deploy `020264d` (v49); production was v45 (cold-cache crash).
- **Mac Safari**: production timing on deployed URL (not run in this pass).
- **iPhone G1**: `experiments/g1-atlas.mjs` on device after deploy.
