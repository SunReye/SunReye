import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractGlobs,
  extractImports,
  planPrTests,
  reachableComponents,
  reachableCrates,
  type CrateNode,
} from "./reachable.ts";
import { buildReverseGraph, loadCargoCrates, resolveBaseRef } from "./reachable-fs.ts";

const CRATES: readonly CrateNode[] = [
  { name: "sunreye-pv", dir: "crates/pv", deps: [] },
  { name: "sunreye-profile", dir: "crates/profile", deps: [] },
  { name: "sunreye-catalogue", dir: "packages/catalogue", deps: ["sunreye-pv"] },
  { name: "sunreye-pv-wasm", dir: "crates/pv-wasm", deps: ["sunreye-pv"] },
  { name: "sunreye-profile-wasm", dir: "crates/profile-wasm", deps: ["sunreye-profile"] },
  {
    name: "sunreye-core",
    dir: "apps/home/core",
    deps: ["sunreye-catalogue", "sunreye-profile", "sunreye-pv"],
  },
  {
    name: "sunreye-synth",
    dir: "crates/synth",
    deps: ["sunreye-core", "sunreye-profile", "sunreye-pv"],
  },
];

test("extractImports finds static, side-effect, dynamic, and CSS imports", () => {
  const source = [
    'import Foo from "./foo.svelte";',
    'export { bar } from "../bar.ts";',
    'import "@sunreye/tokens/glass.css";',
    'const lazy = () => import("#lib/scene/stage.ts");',
    '@import "./theme.css";',
  ].join("\n");

  expect(extractImports(source)).toEqual([
    "./foo.svelte",
    "../bar.ts",
    "@sunreye/tokens/glass.css",
    "#lib/scene/stage.ts",
    "./theme.css",
  ]);
});

test("reachableCrates walks reverse workspace dependencies from changed files", () => {
  expect(reachableCrates(["crates/pv/src/shade.rs"], CRATES)).toEqual([
    "sunreye-catalogue",
    "sunreye-core",
    "sunreye-pv",
    "sunreye-pv-wasm",
    "sunreye-synth",
  ]);
});

test("reachableCrates runs only core and synth when only core changes", () => {
  expect(reachableCrates(["apps/home/core/src/api.rs"], CRATES)).toEqual([
    "sunreye-core",
    "sunreye-synth",
  ]);
});

test("reachableCrates returns empty when only frontend or docs change", () => {
  expect(reachableCrates(["apps/home/web/src/lib/foo.ts", "README.md"], CRATES)).toEqual([]);
});

test("reachableCrates returns all on workspace-level Rust config changes", () => {
  expect(reachableCrates(["Cargo.lock"], CRATES)).toBe("all");
});

test("reachableCrates includes profile and core when a profile definition changes", () => {
  expect(reachableCrates(["profiles/deye/sg05lp3.ts"], CRATES)).toEqual([
    "sunreye-core",
    "sunreye-profile",
    "sunreye-profile-wasm",
    "sunreye-synth",
  ]);
});

test("reachableComponents walks reverse edges to affected .svelte.test.ts files", () => {
  const reverse = {
    "apps/home/web/src/lib/a.ts": ["apps/home/web/src/lib/b.svelte"],
    "apps/home/web/src/lib/b.svelte": [
      "apps/home/web/src/lib/b.svelte.test.ts",
      "apps/home/web/src/lib/c.svelte.test.ts",
    ],
  };

  expect(reachableComponents(["apps/home/web/src/lib/a.ts"], reverse)).toEqual([
    "src/lib/b.svelte.test.ts",
    "src/lib/c.svelte.test.ts",
  ]);
});

test("reachableComponents returns all on global web harness or token changes", () => {
  expect(reachableComponents(["apps/home/web/src/page.setup.ts"], {})).toBe("all");
  expect(reachableComponents(["packages/tokens/glass.css"], {})).toBe("all");
  expect(reachableComponents(["apps/home/web/messages/en.json"], {})).toBe("all");
});

test("extractGlobs finds import.meta.glob patterns, one or several", () => {
  const source = [
    'const a = import.meta.glob<{ default: C }>("./sections/*.svelte", { eager: true });',
    'const b = import.meta.glob(["../ui/*/index.ts", "../../x/*/index.ts"]);',
  ].join("\n");

  expect(extractGlobs(source)).toEqual([
    "./sections/*.svelte",
    "../ui/*/index.ts",
    "../../x/*/index.ts",
  ]);
});

test("a file the page setup imports reaches every component test", () => {
  const reverse = {
    "apps/home/web/src/lib/motion/loop.harness.ts": ["apps/home/web/src/page.setup.ts"],
  };

  expect(reachableComponents(["apps/home/web/src/lib/motion/loop.harness.ts"], reverse)).toBe(
    "all",
  );
});

test("reachableComponents returns empty for backend-only diffs", () => {
  expect(reachableComponents(["apps/home/core/src/api.rs"], {})).toEqual([]);
});

test("planPrTests combines crate, component, bun, and consumer scoping", () => {
  const reverse = {
    "packages/pv-wasm/index.js": ["apps/home/web/src/lib/builder/pv.svelte.test.ts"],
  };

  const plan = planPrTests(["crates/pv/src/shade.rs"], CRATES, reverse);

  expect(plan.crates).toEqual([
    "sunreye-catalogue",
    "sunreye-core",
    "sunreye-pv",
    "sunreye-pv-wasm",
    "sunreye-synth",
  ]);
  expect(plan.components).toEqual(["src/lib/builder/pv.svelte.test.ts"]);
  expect(plan.bunAll).toBe(true);
  expect(plan.consumer).toBe(true);
});

test("planPrTests skips consumer and cargo on web-only diff", () => {
  const reverse = {
    "apps/home/web/src/lib/x.ts": ["apps/home/web/src/lib/x.svelte.test.ts"],
  };

  const plan = planPrTests(["apps/home/web/src/lib/x.ts"], CRATES, reverse);

  expect(plan.crates).toEqual([]);
  expect(plan.components).toEqual(["src/lib/x.svelte.test.ts"]);
  expect(plan.bunAll).toBe(false);
  expect(plan.consumer).toBe(false);
});

test("a change to what bun tests read from disk runs every bun test", () => {
  for (const file of [
    "crates/pv/src/shade.rs",
    "crates/profile/src/setting.rs",
    "profiles/deye-sg05lp3.json",
    "docs/adr/0004-roles-and-conventions.md",
    "apps/home/web/messages/de.json",
    "packages/builder/messages/en.json",
    "GLOSSARY.md",
  ])
    expect([file, planPrTests([file], CRATES, {}).bunAll]).toEqual([file, true]);
});

test("without a base to diff against there is no PR scope", async () => {
  const repo = await mkdtemp(join(tmpdir(), "reachable-"));

  const git = (...args: readonly string[]) =>
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });

  try {
    git("init", "-q", "-b", "main");
    git("commit", "-q", "--allow-empty", "-m", "one");

    expect(resolveBaseRef(repo, "no-such-branch")).toBeUndefined();
    expect(resolveBaseRef(repo, "main")).toMatch(/^[0-9a-f]{40}$/u);
  } finally {
    await rm(repo, { recursive: true });
  }
});

test("filesystem adapters read this workspace's cargo crates and web import graph", () => {
  const root = new URL("..", import.meta.url).pathname;
  const crates = loadCargoCrates(root);
  const reverse = buildReverseGraph(root);

  expect(crates.some((crate) => crate.name === "sunreye-core")).toBe(true);
  expect(Object.keys(reverse).length).toBeGreaterThan(100);
  // Through `import.meta.glob`.
  expect(reverse["apps/home/web/src/lib/gallery/sections/Buttons.svelte"]).toContain(
    "apps/home/web/src/lib/gallery/Gallery.svelte",
  );
});
