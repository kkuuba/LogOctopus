import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API calls to the Flask backend during development so you don't
    // need CORS headers in dev mode. Remove / adjust if you deploy separately.
    proxy: {
      "/api": {
        target: "http://localhost:8050",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
