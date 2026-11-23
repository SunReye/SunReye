// The package as npm would ship it (ADR 25): a consumer with no build step instantiates the engine
// from the installed package and type-checks its answers.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPv } from "./index.js";

const here = new URL(".", import.meta.url).pathname;
const tsrs = join(here, "../../node_modules/.bin/tsrs");

let out = "";

/** Packs the package in `dir` and installs the tarball where a consumer's resolver finds it. */
async function install(dir: string, name: string): Promise<void> {
  const pack = Bun.spawnSync(["bun", "pm", "pack", "--quiet", "--destination", out], { cwd: dir });

  if (pack.exitCode !== 0) throw new Error(pack.stderr.toString());

  const tarball = join(out, pack.stdout.toString().trim().split("/").pop() ?? "");
  const installed = join(out, "node_modules", "@sunreye", name);

  await mkdir(installed, { recursive: true });
  Bun.spawnSync(["tar", "-xzf", tarball, "-C", installed, "--strip-components=1"]);
}

beforeAll(async () => {
  out = await mkdtemp(join(tmpdir(), "sunreye-pv-wasm-"));
  await install(here, "pv-wasm");
  // The scene's types the loader's answers are written in come with it, as npm would install them.
  await install(join(here, "../scene"), "scene");
  await Bun.write(join(out, "package.json"), JSON.stringify({ type: "module" }));
  await Bun.write(
    join(out, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, module: "nodenext", types: [] },
      include: ["consumer.ts"],
    }),
  );
});

afterAll(async () => {
  await rm(out, { recursive: true, force: true });
});

test("the package ships the engine beside its loader", async () => {
  const files = await readdir(join(out, "node_modules", "@sunreye", "pv-wasm"), {
    recursive: true,
  });

  expect(files.toSorted()).toEqual([
    "dist",
    "dist/pv.wasm",
    "geometry.d.ts",
    "index.d.ts",
    "index.js",
    "layout.d.ts",
    "package.json",
    "replies.js",
  ]);
});

/** What a consumer's module prints when Bun runs it from beside the installed package. */
async function run(consumer: string): Promise<string> {
  await Bun.write(join(out, "consumer.js"), consumer);

  const ran = Bun.spawnSync(["bun", "consumer.js"], { cwd: out });

  return ran.stdout.toString() + ran.stderr.toString();
}

test("a consumer instantiates the engine from the installed package", async () => {
  const printed = await run(`
import { loadPv } from "@sunreye/pv-wasm";

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));
const pv = await loadPv(await Bun.file(wasm).bytes());
const { zenith } = pv.sun(Date.UTC(2026, 5, 21, 11) / 1000, { latitude: 50, longitude: 8 });

console.log(Math.round(zenith));
`);

  expect(printed.trim()).toBe("27");
});

/** What the type checker says of a consumer's module; empty when it checks. */
async function check(consumer: string): Promise<string> {
  await Bun.write(join(out, "consumer.ts"), consumer);

  const ran = Bun.spawnSync([tsrs, "-p", "tsconfig.json"], { cwd: out });

  return ran.stdout.toString() + ran.stderr.toString();
}

const SHADED = `
import { loadPv, type Geometry, type Pv } from "@sunreye/pv-wasm";
import type { Scene } from "@sunreye/scene";

declare const bytes: Uint8Array<ArrayBuffer>;

const pv: Pv = await loadPv(bytes);
const scene: Scene = { north: 180, blocks: [], obstacles: [] };
const geometry: Geometry = pv.geometry(scene);

export const roofs = geometry.faces.filter((face) => face.surface === "roof").length;
`;

test("a consumer types the engine's answers with the published types", async () => {
  expect(await check(SHADED)).toBe("");
  expect(
    await check(SHADED.replace("pv.geometry(scene)", "pv.geometry({ north: 180 })")),
  ).toContain("is missing the following properties");
});

test("the loader is what its declarations say", () => {
  const ran = Bun.spawnSync(
    [
      tsrs,
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--allowJs",
      "--checkJs",
      "--module",
      "preserve",
      "--target",
      "esnext",
      "--types",
      "",
      "index.js",
      "replies.js",
    ],
    { cwd: here },
  );

  expect(ran.stdout.toString() + ran.stderr.toString()).toBe("");
});

// The loader checks the engine it is given: a build without the glue crate's exports is refused.
test("a WASM module without the engine's exports is refused", async () => {
  const empty = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

  let refused = "";

  try {
    await loadPv(empty);
  } catch (error) {
    refused = String(error);
  }

  expect(refused).toBe("TypeError: pv WASM lacks an export");
});
