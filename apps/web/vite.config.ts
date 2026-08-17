import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

import { getWebManualChunk } from "./vite.chunks.ts";

const srcPath = new URL("./src/", import.meta.url);

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL("index.html", import.meta.url)),
        serviceWorker: fileURLToPath(new URL("src/serviceWorker/serviceWorker.ts", import.meta.url))
      },
      output: {
        entryFileNames(chunk) {
          return chunk.name === "serviceWorker"
            ? "service-worker.js"
            : "assets/[name]-[hash].js";
        },
        manualChunks: getWebManualChunk
      }
    }
  },
  plugins: [react(), svgr()],
  resolve: {
    alias: {
      "@api": fileURLToPath(new URL("api", srcPath)),
      "@assets": fileURLToPath(new URL("assets", srcPath)),
      "@components": fileURLToPath(new URL("components", srcPath)),
      "@lib": fileURLToPath(new URL("lib", srcPath)),
      "@models": fileURLToPath(new URL("models", srcPath)),
      "@modules": fileURLToPath(new URL("modules", srcPath)),
      "@pages": fileURLToPath(new URL("pages", srcPath)),
      "@runtime": fileURLToPath(new URL("runtime", srcPath)),
      "@web": fileURLToPath(srcPath)
    }
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:4100",
        xfwd: true
      },
      "/ws": {
        target: "http://localhost:4100",
        changeOrigin: true,
        xfwd: true,
        ws: true
      },
      "/preview": {
        target: "http://localhost:4100",
        changeOrigin: true,
        xfwd: true,
        ws: true
      }
    }
  }
});
