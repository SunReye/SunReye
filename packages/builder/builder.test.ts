// The package as npm would ship it (ADR 25): the canvas resolves from its entry, every shipped file
// compiles, and each imports only what the package ships or declares, its siblings as peers.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { compile, compileModule } from "svelte/compiler";
import manifest from "./package.json" with { type: "json" };

const here = new URL(".", import.meta.url).pathname;

let out = "";
let installed = "";
let shipped: readonly string[] = [];

/**
 * Packs the package and installs the tarball where a consumer's resolver finds it, with the
 * dependencies the workspace installed for it: only those it declares.
 */
async function publish(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sunreye-builder-"));
  const pack = Bun.spawnSync(["bun", "pm", "pack", "--quiet", "--destination", dir], { cwd: here });

  if (pack.exitCode !== 0) throw new Error(pack.stderr.toString());

  const tarball = join(dir, pack.stdout.toString().trim().split("/").pop() ?? "");

  installed = join(dir, "node_modules", "@sunreye", "builder");
  await mkdir(installed, { recursive: true });
  Bun.spawnSync(["tar", "-xzf", tarball, "-C", installed, "--strip-components=1"]);
  await symlink(join(here, "node_modules"), join(installed, "node_modules"));

  return dir;
}

beforeAll(async () => {
  out = await publish();
  const files = await readdir(installed, { recursive: true, encoding: "utf8" });

  shipped = files.filter((file) => !file.startsWith("node_modules"));
});

afterAll(async () => {
  await rm(out, { recursive: true, force: true });
});

/** The package a bare specifier names: `@scope/name` or `name`. */
function packageOf(specifier: string): string {
  const parts = specifier.split("/");

  return (specifier.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)).join("/");
}

/** The shipped files a consumer's bundler compiles. */
const scripts = (): readonly string[] =>
  shipped.filter((file) => /\.(?:svelte|ts)$/u.test(file) && !file.endsWith(".d.ts"));

/** The JavaScript a consumer's bundler sees for a shipped file. */
async function script(file: string): Promise<string> {
  const source = await Bun.file(join(installed, file)).text();

  if (file.endsWith(".svelte")) return compile(source, { filename: file }).js.code;

  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(source);

  return file.endsWith(".svelte.ts") ? compileModule(js, { filename: file }).js.code : js;
}

test("the scene canvas resolves from the package's entry, as a consumer imports it", () => {
  expect(Bun.resolveSync("@sunreye/builder", out)).toBe(join(installed, "src", "index.ts"));
});

test("ships sources and the car's body alone: no test, no harness, and every file compiles", async () => {
  expect(shipped.filter((file) => /\.(?:test|harness)\./u.test(file))).toEqual([]);
  expect(shipped).toContain(join("src", "cars", "car.glb"));
  expect(shipped).toContain(join("src", "builder", "SceneCanvas.svelte"));

  await Promise.all(scripts().map((file) => script(file)));
});

test("a shipped file imports only what the package ships or declares as a peer", async () => {
  const declared = new Set(Object.keys(manifest.peerDependencies));

  /** What `file` imports that the package neither ships nor declares. */
  async function strays(file: string): Promise<string[]> {
    const found: string[] = [];

    for (const { path } of new Bun.Transpiler({ loader: "js" }).scanImports(await script(file))) {
      // An asset's query, as `?url`, is the bundler's.
      const bare = path.split("?")[0] ?? path;

      const ships = bare.startsWith(".")
        ? shipped.includes(normalize(join(dirname(file), bare)))
        : declared.has(packageOf(bare));

      if (!ships) found.push(`${file} → ${path}`);
    }

    return found;
  }

  expect((await Promise.all(scripts().map((file) => strays(file)))).flat()).toEqual([]);
});

/** The `@sunreye` packages among `names`. */
const siblings = (names: readonly string[]) => names.filter((name) => name.startsWith("@sunreye/"));

test("its sibling packages are peers, never dependencies (ADR 25)", () => {
  expect(siblings(Object.keys(manifest.peerDependencies)).toSorted()).toEqual([
    "@sunreye/pv-wasm",
    "@sunreye/scene",
    "@sunreye/ui",
  ]);
  expect("dependencies" in manifest).toBe(false);
  expect(siblings(Object.keys(manifest.devDependencies))).toEqual([]);
});
