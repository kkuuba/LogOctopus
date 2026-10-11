#!/usr/bin/env node
// Copies the real frontend into the demo, then verifies the mock still covers it.
//
//   npm run sync                       # looks for ../frontend/src/LogOctopus.jsx, ../src/LogOctopus.jsx …
//   npm run sync -- path/to/LogOctopus.jsx
//
// The demo never edits LogOctopus.jsx — keep it a pure copy so syncing is trivial.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkApiCoverage } from "./check-api-coverage.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dest = path.resolve(here, "../src/LogOctopus.jsx");
const candidates = [
  process.argv[2],
  path.resolve(here, "../../frontend/src/LogOctopus.jsx"),
  path.resolve(here, "../../frontend/LogOctopus.jsx"),
  path.resolve(here, "../../src/LogOctopus.jsx"),
].filter(Boolean).map((p) => path.resolve(p));

const src = candidates.find((p) => fs.existsSync(p));
if (!src) {
  console.error("Could not find LogOctopus.jsx. Pass the path explicitly:\n  npm run sync -- ../path/to/LogOctopus.jsx");
  process.exit(1);
}

const changed = !fs.existsSync(dest) || !fs.readFileSync(src).equals(fs.readFileSync(dest));
fs.copyFileSync(src, dest);
console.log(`${changed ? "Updated" : "Already up to date:"} src/LogOctopus.jsx  ←  ${path.relative(process.cwd(), src)}`);

const { missing } = checkApiCoverage(dest);
if (missing.length) {
  console.error("\nThe frontend now calls endpoints the demo mock doesn't handle:");
  for (const m of missing) console.error(`  ✗ ${m.path}`);
  console.error("\nAdd an on(...) route for each in src/mock/mockApi.js (see the existing ones), then run `npm test`.");
  process.exit(1);
}
console.log("Mock API covers every endpoint the frontend uses ✓");
