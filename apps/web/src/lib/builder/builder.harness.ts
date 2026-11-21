// Shared by the builder's component tests: the crate, a module type, the plant's devices, a core
// that answers layout changes, and the inspector's moves.
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import wasm from "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm?url";
import { connect, type ModuleType, type Transport } from "../api/core.ts";
import { finish } from "../motion/animations.harness.ts";
import Builder from "./Builder.svelte";
import { emptyDraft, fillGrid } from "./modules.ts";
import { faceView, onView, presetView, type View } from "./projection.harness.ts";
import { loadPv, type Scene } from "./pv.ts";
import { fill } from "./templates.ts";

export { press, tap, type Pointer } from "./pointer.harness.ts";

export { settle, stepUntil } from "../motion/clock.harness.ts";

export const pv = await loadPv(new Uint8Array(await (await fetch(wasm)).arrayBuffer()));

export const MODULE: ModuleType = {
  id: 7,
  name: "Owner 400",
  pmax: 400,
  vmp: 34,
  imp: 11.76,
  voc: 41,
  isc: 12.5,
  powerCoefficient: -0.35,
  voltageCoefficient: -0.27,
  currentCoefficient: 0.05,
  width: 1.134,
  height: 1.722,
  bypassDiodes: 3,
};

/** A 10 m × 8 m gable house facing south, as its template places it. */
export const house = () => fill(emptyDraft(), "gable");

/** The south face of the default 10 m × 8 m gable house. */
export const SOUTH = "Baukörper 1, Fläche 2";

/** A core that keeps each layout change and answers it saved, with a cold-voltage warning. */
export function testCore(): Transport & { readonly puts: unknown[] } {
  const puts: unknown[] = [];

  return {
    base: "http://core.test/",
    puts,
    fetch: async (request) => {
      // The live stream stays open and silent.
      if (request.method === "GET") return Promise.withResolvers<Response>().promise;

      if (request.url.endsWith("/api/v1/car-bodies")) {
        return Response.json({ id: "ab".repeat(32) }, { status: 201 });
      }

      const change: unknown = await request.json();

      puts.push(change);

      return Response.json({
        appliesFrom: "2026-10-31T23:00:00Z",
        strings: [
          {
            id: 5,
            name: "String 1",
            moduleType: 7,
            device: 1,
            input: 1,
            modules: 1,
            optimized: 0,
            tilt: 35,
            azimuth: 0,
            loss: 2,
          },
        ],
        warnings: [{ string: 5, openCircuitVoltage: 807.741, maxInputVoltage: 800 }],
      });
    },
  };
}

export const DEVICES = [
  { id: 1, name: "Deye", profile: "deye-sg05lp3", connection: 1, unit: 1 },
  { id: 2, name: "Speicher", profile: "pylontech", connection: 1, unit: 2 },
  { id: 3, name: "Wallbox", profile: "evcc", connection: 2, unit: 1 },
];

/** The inspector beside the canvas. */
export const inspector = () => page.getByRole("complementary", { name: "Szene bearbeiten" });

/** A row's name starts with its label; its value or summary follows. */
export const starts = (label: string): RegExp =>
  new RegExp(`^${label.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`)}`, "u");

/** Opens the inspector's rows, or its back buttons, one after another: the header's comes first. */
export async function drill(...rows: readonly string[]): Promise<void> {
  for (const name of rows) {
    // oxlint-disable-next-line no-await-in-loop -- each row is on the level the last click opened.
    await inspector()
      .getByRole("button", { name: starts(name) })
      .first()
      .click();
  }
}

/** Types `value` into a number row's value editor and applies it. */
export async function enter(row: string, value: string): Promise<void> {
  await inspector()
    .getByRole("button", { name: starts(`${row} `) })
    .click();
  await page.getByRole("button", { name: /tippen zum Eingeben/u }).click();
  await userEvent.fill(page.getByRole("textbox", { name: `${row} eingeben` }), value);
  await userEvent.keyboard("{Enter}");
  await apply();
}

/** Applies the open value editor; it has left once its fade has ended. */
async function apply(): Promise<void> {
  const button = page.getByRole("button", { name: /^Übernehmen/u });

  await button.click();
  await finish(() => button.query() === null);
}

/** Picks `option` in a choice row's value editor and applies it. */
export async function choose(row: string, option: string): Promise<void> {
  await inspector()
    .getByRole("button", { name: starts(`${row} `) })
    .click();
  await page.getByRole("radiogroup", { name: row }).getByRole("radio", { name: option }).click();
  await apply();
}

export async function gridOnTheSouthFace(transport: Transport) {
  const screen = await render(Builder, {
    pv,
    core: connect(transport),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Module", SOUTH, MODULE.name);

  return screen;
}

/** At a laptop's size, with every inspector level landing at once: the tests read what it shows,
 * not how it slides. */
export async function desk(): Promise<void> {
  await page.viewport(1280, 900);
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
}

export async function undesk(): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
}

/** Where a point lands on the builder's canvas, seen from `kept` or else its first view: the
 * isometric preset. */
export function onCanvas(
  start: Scene,
  kept?: View,
): (at: readonly [number, number, number]) => [number, number] {
  const canvas = page.getByLabelText("3D-Szene des Hauses").element().getBoundingClientRect();
  const view = kept ?? presetView("isometric", pv.geometry(start), canvas.width / canvas.height);

  return onView(view, canvas);
}

/** A phone held upright, its inspector levels landing at once. */
export async function phone(): Promise<void> {
  await page.viewport(390, 844);
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
}

/** The module type's size, by its id, as the crate lays cells out. */
export const SIZES = { [MODULE.id]: { width: MODULE.width, height: MODULE.height } };

/** The view a phone flies to when grid `grid`'s face is opened for its modules. */
export function ontoFace(start: Scene, grid: number): View {
  const at = start.grids?.[grid];

  const roof = pv
    .modules(start, SIZES)
    .roofs.find((r) => r.block === at?.block && r.face === at.face);

  const canvas = page.getByLabelText("3D-Szene des Hauses").element().getBoundingClientRect();

  if (roof === undefined) throw new Error(`no face under grid ${String(grid)}`);

  return faceView(roof, canvas.width / canvas.height);
}

/** Where the point `across` and `up` the face of grid `grid` of `start` lands on the page, seen
 * from `kept` or else its first view. */
export function faceOnPage(
  start: Scene,
  grid: number,
  kept?: View,
): (across: number, up: number) => [number, number] {
  const onPage = onCanvas(start, kept);
  const at = start.grids?.[grid];

  const roof = pv
    .modules(start, SIZES)
    .roofs.find((r) => r.block === at?.block && r.face === at.face);

  if (roof === undefined) throw new Error(`no face under grid ${String(grid)}`);

  const { origin, across: right, up: rise } = roof;

  return (across, up) => {
    const along = (i: 0 | 1 | 2): number => origin[i] + across * right[i] + up * rise[i];

    // East, north, up to three.js's x, y up, z south.
    return onPage([along(0), along(2), 0 - along(1)]);
  };
}

/** Where the middle of a portrait module in row `row` and column `column` of a filled face lands on
 * the page, by the key `row.column`: a tap there lays a module at that place. */
export function cellsOnPage(
  start: Scene,
  grid: number,
  kept?: View,
): (key: string) => [number, number] {
  const onPage = faceOnPage(start, grid, kept);
  const setback = start.grids?.[grid]?.setback ?? 0;

  return (key) => {
    const [row = 0, column = 0] = key.split(".").map(Number);

    return onPage(
      setback + column * (MODULE.width + 0.02) + MODULE.width / 2,
      setback + row * (MODULE.height + 0.02) + MODULE.height / 2,
    );
  };
}

/** The scene with grid `grid` filled, as "Fläche füllen" fills it. */
export function filledFace(scene: Scene, grid: number): Scene {
  return fillGrid(scene, grid, pv.fillFace({ scene, sizes: SIZES, grid }));
}
