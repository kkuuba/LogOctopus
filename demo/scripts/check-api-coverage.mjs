#!/usr/bin/env node
// Verifies the demo's mock backend handles every /api path that the frontend uses.
//
//   npm run check:api                    # checks src/LogOctopus.jsx
//   node scripts/check-api-coverage.mjs path/to/LogOctopus.jsx
//
// Exit code 1 + a list of missing endpoints if the frontend calls something the
// mock doesn't know about — i.e. the demo would break on that feature.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMockApi } from "../src/mock/mockApi.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** All distinct /api paths referenced in a frontend source file ("${x}" → ":p"). */
export function extractApiPaths(source) {
  const found = new Set();
  for (const rawLine of source.split("\n")) {
    const line = rawLine.replace(/\$\{[^}]*\}/g, ":p");
    for (const m of line.matchAll(/\/api\/[^\s`"'\\)]*/g)) {
      const p = m[0].split("?")[0].replace(/\/+$/, "");
      if (/^\/api\/[A-Za-z0-9_\-:/.]+$/.test(p)) found.add(p);
    }
  }
  return [...found].sort();
}

export function checkApiCoverage(jsxPath) {
  const source = fs.readFileSync(jsxPath, "utf8");
  const api = createMockApi({ latency: false, persist: false });
  const rows = extractApiPaths(source).map((p) => {
    const route = api.routes.find((r) => r.re.test(p));
    return { path: p, handled: route ? route.pattern : null };
  });
  return { rows, missing: rows.filter((r) => !r.handled) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const target = path.resolve(process.argv[2] || path.join(here, "../src/LogOctopus.jsx"));
  const { rows, missing } = checkApiCoverage(target);
  console.log(`Checked ${rows.length} API paths in ${path.relative(process.cwd(), target)}\n`);
  for (const r of rows) console.log(`  ${r.handled ? "✓" : "✗"} ${r.path}${r.handled ? "" : "   ← no mock handler"}`);
  if (missing.length) {
    console.error(`\n${missing.length} endpoint(s) missing from src/mock/mockApi.js — add an on(...) route for each.`);
    process.exit(1);
  }
  console.log("\nAll endpoints covered.");
}
