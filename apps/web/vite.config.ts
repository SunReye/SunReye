import { readdirSync, readFileSync } from "node:fs";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { frameKnown } from "./browser-commands.ts";
import { SCENE } from "./scene-tests.ts";
import { touchFiles } from "./touch-tests.ts";

/** Every lucide icon the sources, the kit's and the builder's packages import, so each new icon is
 * pre-bundled without a list to keep. */
function icons(): string[] {
  const roots = [
    `${import.meta.dirname}/src`,
    `${import.meta.dirname}/../../packages/ui/src`,
    `${import.meta.dirname}/../../packages/builder/src`,
  ];

  const sources = roots.flatMap((src) =>
    readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(?:svelte|ts)$/u.test(file))
      .map((file) => readFileSync(`${src}/${file}`, "utf8")),
  );

  const found = sources.flatMap(
    (source) => source.match(/@lucide\/svelte\/icons\/[a-z0-9-]+/gu) ?? [],
  );

  return [...new Set(found)].toSorted();
}

function release(): string {
  const cargo = readFileSync(`${import.meta.dirname}/../../Cargo.toml`, "utf8");

  return /^\[workspace\.package\]\nversion = "([^"]+)"/mu.exec(cargo)?.[1] ?? "dev";
}

const touch = touchFiles(import.meta.dirname);

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: { runes: true },
      // Hash router and relative paths: the SPA works at `/` and under any ingress prefix (ADR 11).
      adapter: adapter({ precompress: true }),
      router: { type: "hash" },
      // The release's version, not the build's time: the same sources build the same SPA, which
      // the core embeds and the gate's cache hashes (ADR 13).
      version: { name: release() },
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
      "three/src/extras/Earcut.js",
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
    setupFiles: ["src/page.setup.ts"],
    // The one hang guard per suite (scripts/fake-time.ts): no test or wait sets its own, and none
    // is the thing tested. A loaded machine makes a run slower, never red.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    expect: { poll: { timeout: 60_000 } },
    browser: {
      enabled: true,
      headless: true,
      // A page opened while every project's dependencies are bundled cold, on a loaded machine.
      connectTimeout: 120_000,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      commands: { frameKnown },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "dom",
          include: ["src/**/*.svelte.test.ts"],
          exclude: [...SCENE, ...touch.map(({ file }) => file)],
          // A file here that draws with WebGL fails: it belongs in SCENE (page.setup.ts).
          provide: { scene: false },
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "scene",
          include: SCENE,
          exclude: touch.map(({ file }) => file),
          provide: { scene: true },
          // Without a GPU every page's WebGL runs through one software renderer: the studio scenes
          // of files run side by side starve each other into timeouts.
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
      // A file that emulates touch leaves its tab without a mouse (touch-tests.ts): each such file
      // is a project of its own, so no other file shares its tab. A scene one runs after the scene
      // project, one at a time, for the same software renderer.
      ...touch.map(({ file, scene }, i) => ({
        extends: true,
        test: {
          name: `touch ${file}`,
          include: [file],
          provide: { scene },
          sequence: { groupOrder: scene ? 2 + i : 0 },
        },
      })),
    ],
  },
});
