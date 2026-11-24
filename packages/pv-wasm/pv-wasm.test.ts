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
    "stringing.d.ts",
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

/** A consumer that runs a plant over three quarter hours, with and without its inverter's type,
 * and prints what it checked. */
const YEAR = `
import { loadPv } from "@sunreye/pv-wasm";

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));
const pv = await loadPv(await Bun.file(wasm).bytes());
const wiring = { device: 7, input: 2, loss: 2, modules: 16, name: "", optimized: 0, tilt: 35 };
const plant = {
  location: { latitude: 52.52, longitude: 13.38 },
  scene: { north: 180, blocks: [], obstacles: [] },
  moduleTypes: [{
    id: 1, vmp: 34.5, imp: 12.17, voc: 41.5, isc: 12.95, voltageCoefficient: -0.26,
    currentCoefficient: 0.048, width: 1.134, height: 1.722, bypassDiodes: 3,
  }],
  strings: [
    { ...wiring, moduleType: 1, azimuth: 0 },
    { ...wiring, moduleType: 2, azimuth: 0 },
    { ...wiring, moduleType: 1, azimuth: 180 },
  ],
  // 2026-06-21 from 10:45 UTC, a quarter hour apart: two bright samples, then night.
  weather: {
    start: Date.UTC(2026, 5, 21, 10, 45) / 1000,
    step: 900,
    ghi: [850, 880, 0],
    dni: [780, 800, 0],
    dhi: [150, 150, 0],
    temperature: [24, 25, 15],
  },
};
const ran = pv.year(plant);
const limits = (startVoltage) => ({ maxCurrent: 30, minVoltage: 150, maxVoltage: 1000, startVoltage });
// Input 2 of device 7 starts above its strings' open-circuit voltage, 16 × 41.5 V.
const neverStarts = pv.year({ ...plant, inverterTypes: { 7: {
  maker: "Example", model: "Two inputs", maxInputVoltage: 1100, acRating: 10000, efficiency: 97,
  inputs: [limits(180), limits(900)],
} } });
// Rated far under the plant's 32 modules, so noon clips.
const typed = pv.year({ ...plant, inverterTypes: { 7: {
  maker: "Example", model: "Small", maxInputVoltage: 1100, acRating: 1000, efficiency: 97,
  inputs: [limits(180), limits(180)],
} } }).inverters[0];
const [south, unknown, north] = ran.strings;
const [inverter] = ran.inverters;
const [input] = inverter.inputs;

console.log(JSON.stringify({
  device: inverter.device,
  input: input.input,
  southInJuneOnly: south.months.every((wh, month) => (month === 5) === wh > 0),
  southHolds: south.total > 2 * 0.25 * 3000 && south.total < 2 * 0.25 * 9000,
  unknown: unknown.total,
  northBelowSouth: north.total < south.total,
  stringsSum: Math.abs(south.total + north.total - input.energy.total) < 1e-6,
  inputsSum: Math.abs(input.energy.total - inverter.dc.total) < 1e-6,
  monthsSum: Math.abs(inverter.dc.months.reduce((a, b) => a + b) - inverter.dc.total) < 1e-6,
  neverStarts: neverStarts.inverters[0].dc.total,
  untypedHasNoAc: !("ac" in inverter),
  typedDcAsBefore: typed.dc.total === inverter.dc.total,
  acBelowDc: typed.ac !== undefined && typed.ac.energy.total + typed.ac.clipped.total < typed.dc.total,
  clipped: (typed.ac?.clipped.total ?? 0) > 0,
}));
`;

// A year's run needs no browser: a consumer under Bun runs a plant through the engine (ADR 17).
test("a consumer runs a plant over a year of weather", async () => {
  const printed = await run(YEAR);
  expect(JSON.parse(printed)).toEqual({
    device: 7,
    input: 2,
    southInJuneOnly: true,
    southHolds: true,
    unknown: 0,
    northBelowSouth: true,
    stringsSum: true,
    inputsSum: true,
    monthsSum: true,
    neverStarts: 0,
    untypedHasNoAc: true,
    typedDcAsBefore: true,
    acBelowDc: true,
    clipped: true,
  });
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

/** A sibling package as a consumer names it by path. */
function byPath(name: string): string {
  return `file:${join(here, "..", name)}`;
}

// Until the packages are published, SunReye Plan installs them by path (ADR 25, 2026-11-23): the
// consumer supplies each package once, and the loader's declarations find the scene's types there.
test("a consumer that installs the packages by path types the engine's answers", async () => {
  const consumer = await mkdtemp(join(tmpdir(), "sunreye-by-path-"));
  const packages = ["catalogue", "pv-wasm", "scene", "tokens"];

  try {
    await Bun.write(
      join(consumer, "package.json"),
      JSON.stringify({
        type: "module",
        dependencies: Object.fromEntries(
          packages.map((name) => [`@sunreye/${name}`, byPath(name)]),
        ),
        // Bun satisfies a package's peer from the registry, never from a folder the consumer names.
        overrides: { "@sunreye/scene": byPath("scene") },
      }),
    );
    await Bun.write(
      join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: "nodenext",
          types: [],
          // Bun links each file back into this repository; resolve from the consumer's install.
          preserveSymlinks: true,
        },
        include: ["consumer.ts"],
      }),
    );
    await Bun.write(join(consumer, "consumer.ts"), SHADED);

    const installed = Bun.spawnSync(["bun", "install", "--no-save"], { cwd: consumer });

    expect(installed.stderr.toString()).not.toContain("error:");
    expect(installed.exitCode).toBe(0);

    const checked = Bun.spawnSync([tsrs, "-p", "tsconfig.json"], { cwd: consumer });

    expect(checked.stdout.toString() + checked.stderr.toString()).toBe("");
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
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
