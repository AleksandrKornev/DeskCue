import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import svgr from "vite-plugin-svgr";
import { defineConfig } from "vitest/config";

const srcPath = new URL("./src/", import.meta.url);

export default defineConfig({
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
  test: {
    coverage: {
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.unit.test.{ts,tsx}",
        "src/test/**"
      ],
      include: ["src/**/*.{ts,tsx}"],
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage/web-unit",
      thresholds: {
        branches: 25,
        functions: 29,
        lines: 34,
        statements: 34
      }
    },
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.unit.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"]
  }
});
