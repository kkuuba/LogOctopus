// Build-time patches applied to src/LogOctopus.jsx by the Vite plugin in vite.config.js.
// The file on disk stays a pure copy of the real frontend (so `npm run sync` is a plain
// copy); patches only exist in what the browser receives.
//
// Keep this list tiny. Each patch must say WHY it exists, and `npm test` fails if one
// stops matching after a frontend update, so you notice instead of silently losing it.

export const PATCHES = [
  {
    id: "keep-groups-expanded",
    why:
      "The app force-collapses every device group when the URL carries log_type / search_param / " +
      "search_value (and saves that to localStorage). In the demo this made groups vanish after " +
      "using 'Show Text/Chart Logs'. Groups should always stay visible.",
    pattern: /setCollapsedGroups\(\s*new Set\(\s*data\.map\(\(\s*g\s*\)\s*=>\s*g\.id\s*\)\s*\)\s*\);/,
    replacement: "/* demo patch: keep device groups expanded */",
  },
];

/** Returns { code, applied: [ids], missing: [ids] }. */
export function applyFrontendPatches(source) {
  let code = source;
  const applied = [], missing = [];
  for (const p of PATCHES) {
    if (p.pattern.test(code)) { code = code.replace(p.pattern, p.replacement); applied.push(p.id); }
    else missing.push(p.id);
  }
  return { code, applied, missing };
}
