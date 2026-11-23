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

test("ships its messages compiled, typed for a consumer that reads no JavaScript for types", () => {
  for (const file of ["messages.js", "messages.d.ts", "runtime.js", "runtime.d.ts"])
    expect(shipped).toContain(join("src", "paraglide", file));
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
    "@sunreye/catalogue",
    "@sunreye/pv-wasm",
    "@sunreye/scene",
    "@sunreye/ui",
  ]);
  expect("dependencies" in manifest).toBe(false);
  expect(siblings(Object.keys(manifest.devDependencies))).toEqual([]);
});

/** The package's entries, as `exports` names them. */
const KEYS = Object.keys(manifest.exports);

/** The file each entry points at, as shipped. */
const FILES = new Map<string, string>();

for (const [key, target] of Object.entries(manifest.exports)) {
  FILES.set(key, target.default.replace(/^\.\//u, ""));
}

test("its README lists every entry the package exports, and no other (ADR 25)", async () => {
  const readme = await Bun.file(join(installed, "README.md")).text();

  const listed = readme
    .split("\n")
    .flatMap((line) => /^## `@sunreye\/builder([^`]*)`$/u.exec(line)?.slice(1) ?? [])
    .map((sub) => `.${sub}`);

  expect(listed).toEqual(KEYS);
});

/** The names an entry file exports, as a consumer imports them. */
async function exported(file: string): Promise<string[]> {
  const source = await Bun.file(join(installed, file)).text();
  const names: string[] = [];

  for (const [, list] of source.matchAll(/export (?:type )?\{([^}]*)\}/gu))
    for (const spec of (list ?? "").split(",")) {
      const name = spec
        .replace(/^\s*(?:type\s+)?/u, "")
        .split(/\s+as\s+/u)
        .at(-1)
        ?.trim();

      if (name !== undefined && name !== "") names.push(name);
    }

  return names;
}

test("its README names every export under its entry's heading", async () => {
  const readme = await Bun.file(join(installed, "README.md")).text();
  const sections = readme.split(/^## /mu);
  const missing: string[] = [];

  for (const [key, file] of FILES) {
    const section = sections.find((text) => text.startsWith(`\`@sunreye/builder${key.slice(1)}\``));

    // oxlint-disable-next-line no-await-in-loop -- one entry at a time reads plainer.
    for (const name of await exported(file))
      if (!(section ?? "").includes(`\`${name}\``)) missing.push(`${key} ${name}`);
  }

  expect(missing).toEqual([]);
});

/** What `file` imports: the shipped files by their path, and the packages. */
async function importsOf(file: string): Promise<{ files: string[]; bare: string[] }> {
  const files: string[] = [];
  const bare: string[] = [];

  for (const { path } of new Bun.Transpiler({ loader: "js" }).scanImports(await script(file))) {
    // An asset's URL: no script.
    if (path.includes("?")) continue;

    if (path.startsWith(".")) files.push(normalize(join(dirname(file), path)));
    else bare.push(path);
  }

  return { files, bare };
}

/** Every package and shipped file `entry` imports, itself or through the files it imports. */
function reached(entry: string): Promise<string[]> {
  const seen = new Set<string>();

  const walk = async (file: string): Promise<string[]> => {
    if (seen.has(file)) return [];

    seen.add(file);

    const { files, bare } = await importsOf(file);
    const deeper = await Promise.all(files.map((next) => walk(next)));

    return [...new Set([...bare, ...files, ...deeper.flat()])];
  };

  return walk(normalize(entry));
}

test("only the canvas and its frame load three.js: the others serve screens that draw no scene", async () => {
  const others = KEYS.filter((key) => key !== "." && key !== "./frame");

  const three = await Promise.all(
    others.map(async (key) =>
      (await reached(FILES.get(key) ?? "")).filter((p) => p.startsWith("three")),
    ),
  );

  expect(three).toEqual(others.map(() => []));
});

test("the root entry reaches none of the frame, so a screen that shows the scene leaves it out", async () => {
  const files = await reached(FILES.get(".") ?? "");

  expect(
    files.filter((file) => /\/(Builder|View|Stage|InspectorPane|TimeSlider)\.svelte$/u.test(file)),
  ).toEqual([]);
});

test("the canvas and values entries load no Svelte either, so a unit test reaches them", async () => {
  const svelte = await Promise.all(
    ["./canvas", "./values"].map(async (key) =>
      (await reached(FILES.get(key) ?? "")).filter((p) =>
        /^(?:svelte|@sunreye\/ui)(?:\/|$)/u.test(p),
      ),
    ),
  );

  expect(svelte).toEqual([[], []]);
});
