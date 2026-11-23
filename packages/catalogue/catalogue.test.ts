// The package as npm would ship it (ADR 25), imported by a consumer with no build step.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modules, type Sheet } from "./index.js";

const here = new URL(".", import.meta.url).pathname;

let out = "";

/** Packs the package and installs the tarball where a consumer's resolver finds it. */
async function publish(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sunreye-catalogue-"));
  const pack = Bun.spawnSync(["bun", "pm", "pack", "--quiet", "--destination", dir], { cwd: here });

  if (pack.exitCode !== 0) throw new Error(pack.stderr.toString());

  const tarball = join(dir, pack.stdout.toString().trim().split("/").pop() ?? "");
  const installed = join(dir, "node_modules", "@sunreye", "catalogue");

  await mkdir(installed, { recursive: true });
  Bun.spawnSync(["tar", "-xzf", tarball, "-C", installed, "--strip-components=1"]);

  return dir;
}

beforeAll(async () => {
  out = await publish();
});

afterAll(async () => {
  await rm(out, { recursive: true, force: true });
});

/** A module namespace has a null prototype, so `instanceof Object` cannot narrow it. */
function isCatalogue(module: unknown): module is { readonly modules: readonly Sheet[] } {
  return Object.prototype.hasOwnProperty.call(module, "modules");
}

/** The module sheets, as a consumer imports them. */
async function shipped(): Promise<readonly Sheet[]> {
  const module: unknown = await import(Bun.resolveSync("@sunreye/catalogue", out));

  if (!isCatalogue(module)) throw new TypeError("@sunreye/catalogue exports no modules");

  return module.modules;
}

test("every module sheet ships, as the core bundles them", async () => {
  const sheets = (await readdir(join(here, "modules"))).filter((f) => f.endsWith(".json"));

  expect(modules).toHaveLength(sheets.length);
  expect(await shipped()).toEqual(modules);
});

test("a sheet ships with its source and its power classes as the datasheet prints them", async () => {
  const aiko = (await shipped()).find((s) => s.maker === "AIKO" && s.series === "Neostar 2S+");
  const a450 = aiko?.modules.find((m) => m.name === "AIKO-A450-MAH54Db");

  expect(aiko?.source.revision).toBe("DS_EN_2405_V1.5");
  expect(a450).toMatchObject({ pmax: 450, voc: 40.94, isc: 14.12, bypassDiodes: 3 });
});
