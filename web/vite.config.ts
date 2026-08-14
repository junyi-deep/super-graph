import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: "node_modules/@excalidraw/excalidraw/dist/excalidraw-assets",
  build: { outDir: "../internal/frontend/dist", emptyOutDir: true },
  server: { proxy: { "/api": { target: "http://localhost:7988", ws: true }, "/image": "http://localhost:7988" } },
});
