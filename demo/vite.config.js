import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { applyFrontendPatches } from "./scripts/frontend-patches.mjs";

// Applies the (tiny) demo-only patches from scripts/frontend-patches.mjs to the
// frontend source as it is loaded; the file on disk is never modified.
function demoFrontendPatches() {
  return {
    name: "logoctopus-demo-patches",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]LogOctopus\.jsx(\?|$)/.test(id)) return null;
      const { code: out, missing } = applyFrontendPatches(code);
      for (const m of missing) this.warn(`demo patch "${m}" no longer matches LogOctopus.jsx — see scripts/frontend-patches.mjs`);
      return { code: out, map: null };
    },
  };
}

// Production builds use a relative base ("./"), so the same `dist/` works from any
// URL: user/org pages, project pages (https://<user>.github.io/<repo>/), or a
// plain static host — no configuration needed. Override with VITE_BASE_PATH if
// you want an absolute base (e.g. "/LogOctopus/").
export default defineConfig(({ command }) => ({
  plugins: [demoFrontendPatches(), react()],
  base: process.env.VITE_BASE_PATH || (command === "build" ? "./" : "/"),
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 900, // LogOctopus.jsx is one large component file
  },
}));
