import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Production builds use a relative base ("./"), so the same `dist/` works from any
// URL: user/org pages, project pages (https://<user>.github.io/<repo>/), or a
// plain static host — no configuration needed. Override with VITE_BASE_PATH if
// you want an absolute base (e.g. "/LogOctopus/").
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || (command === "build" ? "./" : "/"),
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 900, // LogOctopus.jsx is one large component file
  },
}));
