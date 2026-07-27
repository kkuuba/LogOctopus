import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Set VITE_BASE_PATH="/your-repo-name/" when building for GitHub Pages
// (project sites are served from https://<user>.github.io/<repo>/).
// Left as "/" for local dev and for user/organization pages.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || "/",
});
