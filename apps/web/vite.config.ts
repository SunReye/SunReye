import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    sveltekit({
      compilerOptions: { runes: true },
      // Hash router and relative paths: the SPA works at `/` and under any ingress prefix (ADR 11).
      adapter: adapter({ precompress: true }),
      router: { type: "hash" },
    }),
  ],
  // Pre-bundled up front: discovering them mid-run reloads the browser and fails the files in flight.
  optimizeDeps: { include: ["three", "three/addons/controls/OrbitControls.js"] },
  test: {
    include: ["src/**/*.svelte.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
