// The package as npm would ship it (ADR 25), imported and type-checked by a consumer with no build
// step.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCENE_SCHEMA, SCENE_SCHEMA_VERSION, roofFaceKey } from "./index.js";

const here = new URL(".", import.meta.url).pathname;
const tsrs = join(here, "../../node_modules/.bin/tsrs");

let out = "";

/** Packs the package and installs the tarball where a consumer's resolver finds it. */
async function publish(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sunreye-scene-"));
  const pack = Bun.spawnSync(["bun", "pm", "pack", "--quiet", "--destination", dir], { cwd: here });

  if (pack.exitCode !== 0) throw new Error(pack.stderr.toString());

  const tarball = join(dir, pack.stdout.toString().trim().split("/").pop() ?? "");
  const installed = join(dir, "node_modules", "@sunreye", "scene");

  await mkdir(installed, { recursive: true });
  Bun.spawnSync(["tar", "-xzf", tarball, "-C", installed, "--strip-components=1"]);
  await Bun.write(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, module: "nodenext", types: [] },
      include: ["consumer.ts"],
    }),
  );

  return dir;
}

beforeAll(async () => {
  out = await publish();
});

afterAll(async () => {
  await rm(out, { recursive: true, force: true });
});

let checkIndex = 0;

type Checked = Readonly<{ code: number; said: string }>;

/** A module that type-checks: exit 0, nothing said; a killed checker says nothing too. */
const CHECKS: Checked = { code: 0, said: "" };

/** The type checker's exit code and what it says of a consumer's module. */
async function check(consumer: string): Promise<Checked> {
  const id = ++checkIndex;
  const file = `consumer-${String(id)}.ts`;
  const config = `tsconfig-${String(id)}.json`;

  await Promise.all([
    Bun.write(join(out, file), consumer),
    Bun.write(
      join(out, config),
      JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, module: "nodenext", types: [] },
        include: [file],
      }),
    ),
  ]);

  const proc = Bun.spawn([tsrs, "-p", config], { cwd: out, stdout: "pipe", stderr: "pipe" });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { code, said: stdout + stderr };
}

const HOUSE = `
import type { Scene } from "@sunreye/scene";

export const house: Scene = {
  north: 180,
  blocks: [
    { x: 0, z: 0, width: 10, depth: 8, eave: 6, rotation: 0, roof: { kind: "gable", pitch: 35 } },
  ],
  obstacles: [{ kind: "tree", x: 14, z: 3, radius: 2, height: 9 }],
  grids: [
    {
      block: 0,
      face: 1,
      moduleType: 1,
      landscape: false,
      setback: 0.3,
      modules: [{ across: 0, up: 0, landscape: false, string: 0 }],
    },
  ],
};
`;

test("a consumer types a scene with the published types", async () => {
  expect(await check(HOUSE)).toEqual(CHECKS);
});

test("the published types refuse what the core refuses", async () => {
  const unknown = HOUSE.replace("north: 180,", "north: 180, south: 0,");
  const dome = HOUSE.replace('"gable"', '"dome"');
  const [unknownOut, domeOut] = await Promise.all([check(unknown), check(dome)]);

  expect(unknownOut.code).not.toBe(0);
  expect(unknownOut.said).toContain("'south' does not exist in type");
  expect(domeOut.code).not.toBe(0);
  expect(domeOut.said).toContain(`Type '"dome"' is not assignable`);
});

test("a consumer types a module type with its datasheet", async () => {
  const sheet = `
import type { ModuleType } from "@sunreye/scene";

export const moduleType: Pick<ModuleType, "id" | "width" | "height"> = { id: 1, width: 1.1, height: 1.7 };
`;

  expect(await check(sheet)).toEqual(CHECKS);
});

/** A module namespace has a null prototype, so `instanceof Object` cannot narrow it. */
function isScene(module: unknown): module is { readonly roofFaceKey: typeof roofFaceKey } {
  return Object.prototype.hasOwnProperty.call(module, "roofFaceKey");
}

/** The roof face key, as a consumer imports it. */
async function shipped(): Promise<typeof roofFaceKey> {
  const module: unknown = await import(Bun.resolveSync("@sunreye/scene", out));

  if (!isScene(module)) throw new TypeError("@sunreye/scene exports no roofFaceKey");

  return module.roofFaceKey;
}

test("a roof face has one key, whichever view selected it", async () => {
  const key = await shipped();
  const grid = { block: 0, face: 1, moduleType: 1, landscape: false, setback: 0.3, modules: [] };

  expect(key({ block: 0, face: 1 })).toBe(roofFaceKey(grid));
  expect(key({ block: 0, face: 1 })).not.toBe(key({ block: 1, face: 0 }));
  expect(key({ block: 1, face: 10 })).not.toBe(key({ block: 11, face: 0 }));
});

test("a consumer traces a roof with the shipped operations, typed", async () => {
  const consumer = `
import { addLine, type Edited, type Scene } from "@sunreye/scene";

const empty: Scene = { north: 0, blocks: [], obstacles: [] };

export const edited: Edited = addLine(empty, { x: 0, z: 0 }, { x: 0, z: 4 }, 0.3);
`;

  const module: unknown = await import(Bun.resolveSync("@sunreye/scene", out));

  expect(await check(consumer)).toEqual(CHECKS);
  expect(Object.prototype.hasOwnProperty.call(module, "addLine")).toBe(true);
});

test("a consumer reads the scene's JSON Schema and the version it was made at from the package", async () => {
  const module: unknown = await import(Bun.resolveSync("@sunreye/scene", out));
  const schema: unknown = Object.getOwnPropertyDescriptor(module, "SCENE_SCHEMA")?.value;
  const version: unknown = Object.getOwnPropertyDescriptor(module, "SCENE_SCHEMA_VERSION")?.value;
  const manifest: unknown = await Bun.file(new URL("package.json", import.meta.url)).json();

  expect(schema).toMatchObject({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $ref: "#/$defs/Scene",
    $defs: { Scene: { required: ["north", "blocks", "obstacles"] } },
  });
  expect(JSON.stringify(schema)).not.toContain("#/components/schemas/");
  expect(manifest).toMatchObject({ version });
  expect([schema, version]).toEqual([SCENE_SCHEMA, SCENE_SCHEMA_VERSION]);
});
