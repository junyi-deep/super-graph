import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({command})=>({
  plugins: [react(), tailwindcss()],
  publicDir: command === "serve" ? "node_modules/@excalidraw/excalidraw/dist/prod" : false,
  build: { outDir: "../internal/frontend/dist", emptyOutDir: true },
  server: { proxy: { "/api": { target: "http://localhost:7988", ws: true }, "/image": "http://localhost:7988" } },
}));
