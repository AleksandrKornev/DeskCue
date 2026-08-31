import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

import { createWebEmbedManualChunk } from "./vite.chunks.ts";

const srcPath = new URL("./src/", import.meta.url);

export default defineConfig({
  build: {
    cssCodeSplit: false,
    lib: {
      cssFileName: "style",
      entry: fileURLToPath(new URL("src/embed/index.ts", import.meta.url)),
      fileName: () => "index.js",
      formats: ["es"]
    },
    outDir: "dist-embed",
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react-router"
      ],
      output: {
        manualChunks: createWebEmbedManualChunk(),
        onlyExplicitManualChunks: true
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
  }
});
