import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: { runes: true },
      // Hash router and relative paths: the SPA works at `/` and under any ingress prefix (ADR 11).
      adapter: adapter({ precompress: true }),
      router: { type: "hash" },
    }),
  ],
  // Pre-bundled up front: discovering them mid-run reloads the browser and fails the files in flight.
  optimizeDeps: {
    include: [
      "three",
      "three/addons/controls/OrbitControls.js",
      "three/addons/loaders/GLTFLoader.js",
      "three/addons/objects/Sky.js",
      "three/addons/postprocessing/EffectComposer.js",
      "three/addons/postprocessing/RenderPass.js",
      "three/addons/postprocessing/GTAOPass.js",
      "three/addons/postprocessing/OutputPass.js",
      "three/addons/geometries/RoundedBoxGeometry.js",
    ],
  },
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
