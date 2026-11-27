import { expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { fileKey, sharedKey, stale } from "./component-cache.ts";
import { opaqueSource, urlImports, type ImportGraph } from "./reachable.ts";
import { buildImportGraph } from "./reachable-fs.ts";

const root = new URL("..", import.meta.url).pathname;

const isFile = (path: string) =>
  statSync(join(root, path), { throwIfNoEntry: false })?.isFile() === true;

const GRAPH: ImportGraph = {
  imports: {
    "a.svelte.test.ts": ["a.svelte", "harness.ts"],
    "a.svelte": ["deep.ts"],
    "b.svelte.test.ts": ["b.svelte"],
    "c.svelte.test.ts": ["reads-a-url.ts"],
  },
  opaque: ["reads-a-url.ts"],
};

const hashes =
  (over: Readonly<Record<string, string>> = {}) =>
  (path: string) =>
    over[path] ?? `hash-of-${path}`;

test("a test's key changes when anything it imports changes, however deep", () => {
  const before = fileKey("a.svelte.test.ts", GRAPH, hashes(), "shared");

  expect(fileKey("a.svelte.test.ts", GRAPH, hashes({ "deep.ts": "edited" }), "shared")).not.toBe(
    before,
  );
  expect(
    fileKey("a.svelte.test.ts", GRAPH, hashes({ "a.svelte.test.ts": "edited" }), "shared"),
  ).not.toBe(before);
});

test("a test's key ignores the files it does not reach", () => {
  expect(fileKey("b.svelte.test.ts", GRAPH, hashes({ "deep.ts": "edited" }), "shared")).toBe(
    fileKey("b.svelte.test.ts", GRAPH, hashes(), "shared"),
  );
});

test("the inputs every test shares change every test's key", () => {
  expect(fileKey("b.svelte.test.ts", GRAPH, hashes(), "other")).not.toBe(
    fileKey("b.svelte.test.ts", GRAPH, hashes(), "shared"),
  );
});

test("what every test shares is keyed with the environment and options the run reads", () => {
  const files = [["bun.lock", "h1"]] as const;
  const key = sharedKey("setup", ["TZ=UTC", "--bail"], files);

  expect(sharedKey("setup", ["TZ=Europe/Berlin", "--bail"], files)).not.toBe(key);
  expect(sharedKey("setup", ["TZ=UTC"], files)).not.toBe(key);
  expect(sharedKey("setup", ["TZ=UTC", "--bail"], [["bun.lock", "h2"]])).not.toBe(key);
  expect(sharedKey("setup", ["TZ=UTC", "--bail"], files)).toBe(key);
});

test("when the page setup reaches a file the graph cannot follow, no test has a key", () => {
  expect(sharedKey(null, [], [])).toBeNull();
});

test("a test that reaches a file the graph cannot follow has no key, so it always runs", () => {
  expect(fileKey("c.svelte.test.ts", GRAPH, hashes(), "shared")).toBeNull();
});

test("a file runs unless its key is the one of its last green run", () => {
  const keys = new Map([
    ["same", "k1"],
    ["changed", "k2"],
    ["never", "k3"],
  ]);

  const green = new Map([
    ["same", "k1"],
    ["changed", "old"],
    ["open", "k"],
  ]);

  expect(
    stale(
      ["same", "changed", "never", "open"],
      (file) => keys.get(file) ?? null,
      (file) => green.get(file) ?? null,
    ),
  ).toEqual(["changed", "never", "open"]);
});

test("a file named by a literal URL beside the source is followed like an import", () => {
  const source = 'const w = new Worker(new URL("./warm.worker.ts", import.meta.url));';

  expect(urlImports(source)).toEqual(["./warm.worker.ts"]);
  expect(opaqueSource(source)).toBe(false);
});

test("a source that reads a file by a URL it computes cannot be followed by its imports", () => {
  expect(opaqueSource("const wasm = new URL(name, import.meta.url);")).toBe(true);
  expect(opaqueSource('const wasm = import.meta.resolve("@sunreye/pv-wasm/pv.wasm");')).toBe(true);
  expect(opaqueSource('import icon from "./icon.svg?raw";')).toBe(false);
  expect(opaqueSource("const path = new URL(request.url).pathname;")).toBe(false);
});

test("the workspace's import graph follows a component test and marks what it cannot follow", () => {
  const graph = buildImportGraph(root);
  const hero = "apps/home/web/src/lib/dashboard/Hero.svelte.test.ts";

  expect(graph.imports[hero]).toContain("apps/home/web/src/lib/dashboard/Hero.svelte");
  expect(graph.opaque).not.toContain(hero);
  // Read by a URL resolved at run time: `import.meta.resolve(…)`.
  expect(graph.opaque).toContain("apps/home/web/src/lib/builder/cursor.test.ts");
  // Every edge names a file, never a folder.
  expect(
    Object.values(graph.imports)
      .flat()
      .filter((path) => !isFile(path)),
  ).toEqual([]);
  // A package's exported subpath, and a literal URL beside the source.
  expect(graph.imports["packages/builder/src/builder/engine.ts"]).toContain(
    "packages/pv-wasm/dist/pv.wasm",
  );
  expect(graph.imports["packages/builder/src/scene/warm.ts"]).toContain(
    "packages/builder/src/scene/warm.worker.ts",
  );
});
