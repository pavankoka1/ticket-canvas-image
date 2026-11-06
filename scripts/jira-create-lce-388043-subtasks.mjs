#!/usr/bin/env node
/**
 * Create 30 Done sub-tasks under LCE-388043 (ticket canvas POC).
 * Auth: source ~/.cursor/atlassian-mcp.env (CONFLUENCE_USERNAME + CONFLUENCE_API_TOKEN).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PARENT = "LCE-388043";
const BASE = "https://pragmaticplay.atlassian.net";
const ASSIGNEE = "712020:1ec45a9e-25a3-4cee-ae38-0e648cca07da";
const POC = "https://ticket-canvas-image.vercel.app/";
const COMPARE = "https://ticket-canvas-image.vercel.app/compare";

function loadEnv() {
  const path = join(homedir(), ".cursor", "atlassian-mcp.env");
  const text = readFileSync(path, "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  const email = env.CONFLUENCE_USERNAME || env.JIRA_EMAIL;
  const token = env.CONFLUENCE_API_TOKEN || env.JIRA_API_TOKEN;
  if (!email || !token) throw new Error("Missing CONFLUENCE_USERNAME / CONFLUENCE_API_TOKEN in atlassian-mcp.env");
  return { email, token };
}

function adfParagraph(text) {
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

function adfDoc(lines) {
  return {
    type: "doc",
    version: 1,
    content: lines.map((t) => adfParagraph(t)),
  };
}

const TASKS = [
  {
    summary: "POC: Hybrid catalog — DomPool + tiled CanvasPool underlay",
    points: 5,
    desc: [
      "Deliver Fortunamania-scale catalog: live DOM near viewport, canvas for scrolled-away tickets.",
      `POC: ${POC} · Compare: ${COMPARE}`,
      "Work: TicketCatalogController, DomPool (80), CanvasPool tiles, setViewport / primeViewport / followViewport.",
      "Done when: add + scroll — bounded DOM, no blank canvas rows after settle.",
    ],
  },
  {
    summary: "POC: Retire per-ticket DOM bake / worker crop (_legacy)",
    points: 2,
    desc: [
      "Isolate unused bakeQueue / bitmapCache / BakeCropClient path; atlases only.",
      `POC: ${POC}`,
      "Work: ticketCatalog/_legacy/, AGENTS.md trust map.",
      "Done when: no live imports from _legacy/.",
    ],
  },
  {
    summary: "POC: Vanilla catalog shell + Fortunamania ticket presets",
    points: 3,
    desc: [
      "Home `/` via mountTicketCatalog(); font gate; six ticketPresets mirroring FM CSS.",
      `POC: ${POC} · Compare presets: ${COMPARE}`,
      "Work: main.tsx, ticketPresets.ts, applyTicketCssVars, frame 1001×231.",
    ],
  },
  {
    summary: "POC: DOM band skipIds + ball draw / FLIP shuffle on DomPool",
    points: 5,
    desc: [
      "No double-paint; dab/sparkle/shuffle on visible DOM; canvas at settled frame off-screen.",
      `POC: ${POC}`,
      "Work: bands.ts, drawGesture, drawPhase, DomPool.playMoves, endRound.",
    ],
  },
  {
    summary: "POC: Canvas tile memory budget & followViewport repaint",
    points: 3,
    desc: [
      "CANVAS_TILE_RETAIN_BYTES eviction; one tile/frame on scroll; resize drops tiles first.",
      `POC: ${POC}`,
      "Work: CanvasPool.ts, constants canvasTileTickets.",
    ],
  },
  {
    summary: "POC: iOS / Safari — no drift, smooth scroll, fast resize repaint",
    points: 5,
    desc: [
      "Physical Safari/iOS verified on deployed build.",
      `POC: ${POC} · svg-all compare row: ${COMPARE}`,
      "Work: iOS fix commits, safari-mobile-canvas-probe, safari-idb-reload-probe.",
    ],
  },
  {
    summary: "Compare lab: difference-blend DOM vs canvas harness",
    points: 3,
    desc: [
      "Regression UI: opacity, blend, preset + render-mode switches, three fixture tickets.",
      `Compare: ${COMPARE}`,
      "Work: Compare.tsx, compareDomAlign, CompareSvgStack.",
    ],
  },
  {
    summary: "Compare: HTML zoom + fixed raster ratio modes (1–3)",
    points: 3,
    desc: [
      "Baseline foreignObject at display DPR; ratio-1/2/2.5/3 softness study.",
      `Compare: ${COMPARE}`,
      "Work: compareRenderMode.ts html + ratio-*.",
    ],
  },
  {
    summary: "Compare: SVG-text multiplier render mode (svg-mult)",
    points: 2,
    desc: [
      "Multiplier label as explicit SVG in DOM and raster clone.",
      `Compare: ${COMPARE}`,
      "Work: compareSvgMultiplier.tsx, usesSvgMultiplier.",
    ],
  },
  {
    summary: "Compare: SVG overlay full ticket (svg-all) — adopted path",
    points: 5,
    desc: [
      "Header, cells, multiplier disc as SVG overlay; reference for atlas-build-plan.",
      `Compare: ${COMPARE} · Catalog: ${POC}`,
      "Work: compareSvgText.ts, paintSvgAllCompareTicket.",
    ],
  },
  {
    summary: "Compare: rendering diagnostics & canvas-dom-pixels probe",
    points: 2,
    desc: [
      "On-device JSON: DPR, backing store, typography rects.",
      `Compare: ${COMPARE}`,
      "Work: compareDiagnostics.tsx, scripts/iphone-compare/probe.mjs.",
    ],
  },
  {
    summary: "Compare: Catalog Safari tile row vs foreignObject capture",
    points: 3,
    desc: [
      "Isolates paintCatalogTicketSvgAll tile composite from FO capture drift.",
      `Compare: ${COMPARE} (svg-all block)`,
      "Work: compareCatalogTileStack.tsx.",
    ],
  },
  {
    summary: "Compare: React native SVG → canvas recipe (north-star)",
    points: 3,
    desc: [
      "renderToStaticMarkup self-contained SVG → canvas (non-FO future art).",
      `Compare: ${COMPARE}`,
      "Work: reactSvgRaster.ts, compareReactSvgRecipe.tsx.",
    ],
  },
  {
    summary: "Compare: legacy sprite-blit paintCatalogTicket stack",
    points: 2,
    desc: [
      "Preserve DOM + atlas sprite overlay path for regression vs restore-catalog.",
      `Compare: ${COMPARE}`,
      "Work: compareSpriteStack.tsx, catalogPaint.ts.",
    ],
  },
  {
    summary: "Capture: foreignObject ticket SVG raster pipeline",
    points: 5,
    desc: [
      "rasterizeCompareTicketSvg, decodeCompareSvgBlob, mechanism-B ink probe.",
      `POC: ${COMPARE}`,
      "Work: ticketSvgRaster.ts.",
    ],
  },
  {
    summary: "Atlas warm: compare preloadComparePack batched sheet captures",
    points: 5,
    desc: [
      "Parallel groups of three; number/badge batches; [atlas-warm] timing.",
      `Compare: ${COMPARE}`,
      "Work: compareCachedSprites.ts.",
    ],
  },
  {
    summary: "Atlas: cell numbers 1–60 from real ticket cell SnapDOM",
    points: 5,
    desc: [
      "Vertical sprite sheet, inkShift, geometry in atlasStore meta.",
      `POC: ${POC}`,
      "Work: cellAtlas.ts, cellNumberSnap.ts, cellSpriteInk.ts.",
    ],
  },
  {
    summary: "Atlas: badge, dab, disc & multiplier host bitmaps",
    points: 5,
    desc: [
      "Hit-state chrome without per-ticket raster.",
      `Compare dab ticket: ${COMPARE}`,
      "Work: badgeAtlas.ts, compareSvgAllPaint warmSvgAllHost*.",
    ],
  },
  {
    summary: "Atlas: header id & win SnapDOM sprites (replace fillText)",
    points: 5,
    desc: [
      "Whole-string header sprites; DOM edge-aligned shiftX/Y; RAM + IDB.",
      `POC: ${POC}`,
      "Work: idDigitAtlas.ts, headerGlyphs.ts.",
    ],
  },
  {
    summary: "Atlas: header glyph phase stamping (WebKit / Chromium)",
    points: 8,
    desc: [
      "Per-char phased sprites; measureHeaderGlyphDeviceXsBatch for catalog tiles.",
      `Compare: ${COMPARE}`,
      "Work: compareGlyphAtlas.ts, compareGlyphEngine.ts.",
    ],
  },
  {
    summary: "Paint: svg-all composite (compare optimized path)",
    points: 5,
    desc: [
      "Chrome FO + badge bands + number patches + stamped glyphs; byte match vs full row.",
      `Compare: ${COMPARE}`,
      "Work: compareSvgAllPaint.ts, assembleCompareSprites.",
    ],
  },
  {
    summary: "Paint: catalog tiles paintCatalogTicketSvgAll integration",
    points: 5,
    desc: [
      "Shared compare warm pack wired into CanvasPool primary path.",
      `Catalog: ${POC}`,
      "Work: catalogSvgPaint.ts, warmCatalogCompareAtlas.",
    ],
  },
  {
    summary: "IDB: catalog cell atlas bingo-cell-atlas persist",
    points: 3,
    desc: [
      "60 PNG blobs + geometry per layout key; reload skips SnapDOM.",
      `POC: ${POC}`,
      "Work: atlasStore.ts loadAtlas/saveAtlas.",
    ],
  },
  {
    summary: "IDB: compare warm sheets + C0–C5 optimizations",
    points: 5,
    desc: [
      "COMPARE_ATLAS_VERSION; skip warm on hit; defer writes; dedupe races; parallel encode.",
      `Compare: ${COMPARE} · perf.mjs cold ~7s → reload ~930ms (v49).`,
      "Work: compareCachedSprites C-series commits.",
    ],
  },
  {
    summary: "Worker: sprite decode off main thread",
    points: 2,
    desc: [
      "spriteDecode.worker + client; PNG/SVG fallback on main thread.",
      `POC: ${POC}`,
      "Work: spriteDecodeClient.ts, spriteDecode.worker.ts.",
    ],
  },
  {
    summary: "Worker: atlas normalize + compare warm PNG encode",
    points: 3,
    desc: [
      "normalize.worker for sheet normalize; comparePersistEncode.worker for IDB PNG (Safari main-thread fallback).",
      `POC: ${POC}`,
      "Work: normalizeClient.ts, comparePersistEncode.worker.ts, comparePersistEncodeClient.ts.",
    ],
  },
  {
    summary: "PNG pipeline: untainted blobs for atlas IDB storage",
    points: 3,
    desc: [
      "bitmapToPngBlob; SVG pack fallback; no tainted canvas persist.",
      `POC: ${POC}`,
      "Work: ticketSvgRaster encode helpers, idDigitAtlas PNG URLs.",
    ],
  },
  {
    summary: "Alignment: DPR cap, integer cell geometry, catalog origin snap",
    points: 5,
    desc: [
      "activeDpr() cap 4; ticketCellGeometry; snapCatalogFrameOrigin / snapLayoutOrigin.",
      `Compare status DPR line: ${COMPARE}`,
      "Work: cellBoxModel.ts, catalogOriginSnap.ts.",
    ],
  },
  {
    summary: "Alignment: runtime FM text baselines from measured CSS",
    points: 3,
    desc: [
      "resolveTicketTextBaselines — no magic em constants; part of compare pack key.",
      `POC: ${POC}`,
      "Work: ticketTextBaselines.ts.",
    ],
  },
  {
    summary: "Ship: Vercel POC, iPhone harness, golden v49, OpenSpec alignment, perf pass",
    points: 8,
    desc: [
      `Public demo: ${POC} · Compare: ${COMPARE}`,
      "iPhone scripts/iphone-compare (f0, g1, golden 60/60 @ DPR 2/3); openspec fix-iphone-ticket-alignment; code optimisation commit.",
      "Confluence catalog: wiki/spaces/LE/pages/6127943745",
    ],
  },
];

async function jira(email, token, path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${opts.method || "GET"} ${path} ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

/** LCE / Jira Software: Story point estimate (GreenHopper). */
const STORY_POINTS_FIELD = "customfield_10075";

function findStoryPointsField(fields) {
  for (const f of fields) {
    const name = (f.name || "").toLowerCase();
    if (name === "story points" || name === "story point estimate") return f.id;
  }
  return STORY_POINTS_FIELD;
}

async function main() {
  const { email, token } = loadEnv();
  const parent = await jira(email, token, `/rest/api/3/issue/${PARENT}`);
  const projectKey = parent.fields.project.key;
  const projectId = parent.fields.project.id;

  const meta = await jira(
    email,
    token,
    `/rest/api/3/issue/createmeta?projectKeys=${projectKey}&issuetypeNames=Sub-task&expand=projects.issuetypes.fields`,
  );
  const subType = meta.projects?.[0]?.issuetypes?.find((t) => t.name === "Sub-task" || t.subtask);
  if (!subType) throw new Error("Sub-task issue type not found in createmeta");
  const subTypeId = subType.id;

  const allFields = await jira(email, token, "/rest/api/3/field");
  let storyField = findStoryPointsField(allFields);
  if (!storyField && subType.fields) {
    for (const [id, f] of Object.entries(subType.fields)) {
      if ((f.name || "").toLowerCase().includes("story point")) storyField = id;
    }
  }

  const transitions = await jira(email, token, `/rest/api/3/issue/${PARENT}/transitions`);
  let doneTransition = transitions.transitions?.find(
    (t) => t.name?.toLowerCase() === "done" || t.to?.name?.toLowerCase() === "done",
  );

  const created = [];

  for (const task of TASKS) {
    const fields = {
      project: { id: projectId },
      parent: { key: PARENT },
      issuetype: { id: subTypeId },
      summary: task.summary,
      description: adfDoc(task.desc),
      assignee: { id: ASSIGNEE },
    };
    if (storyField) fields[storyField] = task.points;

    const issue = await jira(email, token, "/rest/api/3/issue", {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
    created.push(issue.key);

    const trans = await jira(email, token, `/rest/api/3/issue/${issue.key}/transitions`);
    const toDone = trans.transitions?.find(
      (t) => t.name?.toLowerCase() === "done" || t.to?.name?.toLowerCase() === "done",
    );
    if (toDone) {
      await jira(email, token, `/rest/api/3/issue/${issue.key}/transitions`, {
        method: "POST",
        body: JSON.stringify({ transition: { id: toDone.id } }),
      });
    }
    console.log(`${issue.key} · ${task.points} SP · ${task.summary}`);
  }

  console.log(`\nCreated ${created.length} sub-tasks under ${PARENT}:`);
  console.log(created.join(", "));
  if (!storyField) console.warn("\nWarning: Story Points field not found — points may need manual entry.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
