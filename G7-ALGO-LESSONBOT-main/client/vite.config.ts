import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  // `vite preview` serves the production build; the same API proxy keeps the
  // built app verifiable end to end (and SPA fallback covers /chat on refresh).
  preview: {
    port: 4173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@shared/contract": fileURLToPath(new URL("../shared/contract.ts", import.meta.url)),
      "@shared/landing-scenes": fileURLToPath(new URL("../shared/landing-scenes.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
  },
} as never);
