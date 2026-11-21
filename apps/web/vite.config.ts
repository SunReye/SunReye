import { readdirSync, readFileSync } from "node:fs";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { SCENE } from "./scene-tests.ts";

/** Every lucide icon the sources import, so each new icon is pre-bundled without a list to keep. */
function icons(): string[] {
  const src = `${import.meta.dirname}/src`;
  const found = new Set<string>();

  for (const file of readdirSync(src, { recursive: true, encoding: "utf8" })) {
    if (/\.(?:svelte|ts)$/u.test(file)) {
      const source = readFileSync(`${src}/${file}`, "utf8");

      for (const [name] of source.matchAll(/@lucide\/svelte\/icons\/[a-z0-9-]+/gu)) found.add(name);
    }
  }

  return [...found].toSorted();
}

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
      "three/addons/libs/meshopt_decoder.module.js",
      "three/addons/geometries/RoundedBoxGeometry.js",
      "three/addons/objects/Sky.js",
      "three/addons/postprocessing/EffectComposer.js",
      "three/addons/postprocessing/GTAOPass.js",
      "three/addons/postprocessing/OutputPass.js",
      "three/addons/postprocessing/Pass.js",
      "three/addons/postprocessing/RenderPass.js",
      ...icons(),
      "svelte-sonner",
      "vaul-svelte",
      "@internationalized/date",
      "@tanstack/table-core",
      "embla-carousel-svelte",
      "paneforge",
    ],
  },
  test: {
    // Budgets for a page under load: shards run side by side, and a wait ends when its condition holds.
    testTimeout: 30_000,
    expect: { poll: { timeout: 5000 } },
    setupFiles: ["src/storage.setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "dom",
          include: ["src/**/*.svelte.test.ts"],
          exclude: SCENE,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "scene",
          include: SCENE,
          // Without a GPU every page's WebGL runs through one software renderer: the studio scenes
          // of files run side by side starve each other into timeouts.
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
