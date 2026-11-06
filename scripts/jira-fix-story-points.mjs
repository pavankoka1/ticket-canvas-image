#!/usr/bin/env node
/** Set story points on LCE-388047 … LCE-388076 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = "https://pragmaticplay.atlassian.net";
const KEYS = [
  ["LCE-388047", 5],
  ["LCE-388048", 2],
  ["LCE-388049", 3],
  ["LCE-388050", 5],
  ["LCE-388051", 3],
  ["LCE-388052", 5],
  ["LCE-388053", 3],
  ["LCE-388054", 3],
  ["LCE-388055", 2],
  ["LCE-388056", 5],
  ["LCE-388057", 2],
  ["LCE-388058", 3],
  ["LCE-388059", 3],
  ["LCE-388060", 2],
  ["LCE-388061", 5],
  ["LCE-388062", 5],
  ["LCE-388063", 5],
  ["LCE-388064", 5],
  ["LCE-388065", 5],
  ["LCE-388066", 8],
  ["LCE-388067", 5],
  ["LCE-388068", 5],
  ["LCE-388069", 3],
  ["LCE-388070", 5],
  ["LCE-388071", 2],
  ["LCE-388072", 3],
  ["LCE-388073", 3],
  ["LCE-388074", 5],
  ["LCE-388075", 3],
  ["LCE-388076", 8],
];

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
  if (!email || !token) throw new Error("Missing credentials in atlassian-mcp.env");
  return { email, token };
}

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

async function discoverStoryField(email, token, sampleKey) {
  const edit = await jira(email, token, `/rest/api/3/issue/${sampleKey}/editmeta`);
  const names = [];
  for (const [id, meta] of Object.entries(edit.fields || {})) {
    const n = (meta.name || "").toLowerCase();
    if (n.includes("story point") || n === "story points") {
      names.push({ id, name: meta.name, schema: meta.schema });
    }
  }
  if (names.length) return names;

  const all = await jira(email, token, "/rest/api/3/field");
  return all
    .filter((f) => {
      const n = (f.name || "").toLowerCase();
      return n.includes("story point") || n === "story points";
    })
    .map((f) => ({ id: f.id, name: f.name, schema: f.schema }));

  // Also check parent LCE-388043 for populated field
}

async function main() {
  const { email, token } = loadEnv();

  const parent = await jira(email, token, "/rest/api/3/issue/LCE-388043");
  const parentFields = parent.fields;
  const populated = [];
  for (const [k, v] of Object.entries(parentFields)) {
    if (k.startsWith("customfield_") && v != null && typeof v === "number") {
      populated.push({ id: k, value: v });
    }
  }

  let candidates = await discoverStoryField(email, token, "LCE-388047");
  console.log("Story point field candidates:", JSON.stringify(candidates, null, 2));
  console.log("Parent numeric customfields:", populated);

  // Prefer field that exists on parent with a number, or first story point named field
  let fieldId =
    candidates.find((c) => populated.some((p) => p.id === c.id))?.id ||
    candidates[0]?.id;

  if (!fieldId) {
    // Common LCE / Jira Cloud ids
    for (const guess of ["customfield_10016", "customfield_10002", "customfield_10004"]) {
      try {
        await jira(email, token, "/rest/api/3/issue/LCE-388047", {
          method: "PUT",
          body: JSON.stringify({ fields: { [guess]: 1 } }),
        });
        fieldId = guess;
        console.log("Guess worked:", guess);
        break;
      } catch (e) {
        console.log("Guess failed:", guess, String(e).slice(0, 120));
      }
    }
  }

  if (!fieldId) throw new Error("Could not resolve Story Points custom field id");

  console.log(`Using field ${fieldId}\n`);

  for (const [key, points] of KEYS) {
    await jira(email, token, `/rest/api/3/issue/${key}`, {
      method: "PUT",
      body: JSON.stringify({ fields: { [fieldId]: points } }),
    });
    const check = await jira(email, token, `/rest/api/3/issue/${key}?fields=${fieldId}`);
    const got = check.fields[fieldId];
    console.log(`${key}: set ${points} → read ${got}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
