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
      "three/addons/geometries/RoundedBoxGeometry.js",
      "three/addons/objects/Sky.js",
      "three/addons/postprocessing/EffectComposer.js",
      "three/addons/postprocessing/GTAOPass.js",
      "three/addons/postprocessing/OutputPass.js",
      "three/addons/postprocessing/RenderPass.js",
      "@lucide/svelte/icons/arrow-down",
      "@lucide/svelte/icons/arrow-up",
      "@lucide/svelte/icons/battery-charging",
      "@lucide/svelte/icons/car",
      "@lucide/svelte/icons/cpu",
      "@lucide/svelte/icons/fuel",
      "@lucide/svelte/icons/gauge",
      "@lucide/svelte/icons/house",
      "@lucide/svelte/icons/lock",
      "@lucide/svelte/icons/shield-check",
      "@lucide/svelte/icons/sun",
      "@lucide/svelte/icons/utility-pole",
      "svelte-sonner",
    ],
  },
  test: {
    include: ["src/**/*.svelte.test.ts"],
    // Without a GPU every page's WebGL runs through one software renderer: the studio scenes of
    // files run side by side starve each other into timeouts.
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
