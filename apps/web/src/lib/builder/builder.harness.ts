// Shared by the builder's component tests: the crate, a module type, the plant's devices, a core
// that answers layout changes, and the inspector's moves.
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import wasm from "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm?url";
import { connect, type ModuleType, type Transport } from "../api/core.ts";
import Builder from "./Builder.svelte";
import { emptyDraft } from "./modules.ts";
import { loadPv } from "./pv.ts";
import { fill } from "./templates.ts";

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
  await page.getByRole("button", { name: /^Übernehmen/u }).click();
}

/** Picks `option` in a choice row's value editor and applies it. */
export async function choose(row: string, option: string): Promise<void> {
  await inspector()
    .getByRole("button", { name: starts(`${row} `) })
    .click();
  await page.getByRole("radiogroup", { name: row }).getByRole("radio", { name: option }).click();
  await page.getByRole("button", { name: /^Übernehmen/u }).click();
}

export async function saveFrom(day: string): Promise<void> {
  await userEvent.fill(inspector().getByLabelText("Gilt ab"), day);
  await inspector().getByRole("button", { name: "Speichern" }).click();
}

export async function gridOnTheSouthFace(transport: Transport) {
  const screen = await render(Builder, {
    pv,
    core: connect(transport),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Module", SOUTH, "Modulraster auf diese Fläche legen");

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

export type Pointer = "mouse" | "pen" | "touch";

/** A real pointer, through the browser's input pipeline, from `from` to `to` in page pixels. */
export async function press(
  kind: Pointer,
  path: readonly (readonly [number, number])[],
): Promise<void> {
  const [first, ...rest] = path;

  if (first === undefined) return;

  if (kind === "touch") {
    await cdp().send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: first[0], y: first[1] }],
    });

    for (const [x, y] of rest) {
      // oxlint-disable-next-line no-await-in-loop -- a pointer moves one step at a time.
      await cdp().send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    }

    await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    return;
  }

  const mouse = { button: "left", pointerType: kind, clickCount: 1 } as const;

  await cdp().send("Input.dispatchMouseEvent", {
    ...mouse,
    type: "mousePressed",
    x: first[0],
    y: first[1],
  });

  for (const [x, y] of rest) {
    // oxlint-disable-next-line no-await-in-loop -- a pointer moves one step at a time.
    await cdp().send("Input.dispatchMouseEvent", {
      ...mouse,
      type: "mouseMoved",
      buttons: 1,
      x,
      y,
    });
  }

  const [x, y] = rest.at(-1) ?? first;

  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mouseReleased", x, y });
}
