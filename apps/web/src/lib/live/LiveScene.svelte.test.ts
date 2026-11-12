import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import wasm from "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm?url";
import {
  connect,
  type Core,
  type Layout,
  type ModuleType,
  type Transport,
  type Values,
} from "../api/core.ts";
import { loadPv, type Scene } from "../builder/pv.ts";
import { PLANT } from "./labels.ts";
import LiveScene from "./LiveScene.svelte";

const pv = await loadPv(new Uint8Array(await (await fetch(wasm)).arrayBuffer()));

const MODULE: ModuleType = {
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

/** A 10 m × 8 m gable house: two modules of string 0 on the south face, an inverter marker. */
const scene = {
  north: 0,
  blocks: [
    { x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "gable", pitch: 35 } },
  ],
  obstacles: [],
  grids: [
    {
      block: 0,
      face: 1,
      moduleType: 7,
      landscape: false,
      setback: 0.3,
      modules: [
        { row: 0, column: 0, string: 0, optimized: false },
        { row: 0, column: 1, string: 0, optimized: false },
      ],
    },
  ],
  equipment: [{ device: 1, kind: "inverter", block: 0, wall: "front", along: 2, inside: false }],
} satisfies Scene;

const layout: Layout = {
  appliesFrom: "2026-11-01T00:00:00Z",
  scene,
  strings: [
    {
      id: 11,
      name: "Süd",
      moduleType: 7,
      device: 1,
      input: 1,
      modules: 2,
      optimized: 0,
      tilt: 35,
      azimuth: 0,
      loss: 2,
    },
  ],
  warnings: [],
};

interface Ticking {
  readonly core: Core;
  /** Sends a snapshot first, then deltas. */
  readonly tick: (live: Values) => Promise<void>;
}

/** A core whose live stream sends what the test ticks. */
function ticking(): Ticking {
  const { promise, resolve } = Promise.withResolvers<ReadableStreamDefaultController>();
  const encoder = new TextEncoder();
  let name = "snapshot";

  const transport: Transport = {
    base: "http://core.test/",
    fetch: () =>
      Promise.resolve(
        new Response(new ReadableStream({ start: resolve }), {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
  };

  return {
    core: connect(transport),
    tick: async (live) => {
      const event = `event: ${name}\ndata: ${JSON.stringify(live)}\n\n`;

      name = "delta";
      (await promise).enqueue(encoder.encode(event));
    },
  };
}

function frame(string: number, grid: number): Values {
  return {
    devices: {
      "1": { "pv.string.power[11]": string, "pv.power": string },
      [PLANT]: { "grid.power": grid, "load.power": 450 },
    },
  };
}

/** Lets the browser paint `count` frames; a loop would draw in each of them. */
async function frames(count: number): Promise<void> {
  if (count === 0) return;

  await new Promise<void>((painted) => {
    requestAnimationFrame(() => {
      painted();
    });
  });
  await frames(count - 1);
}

beforeEach(async () => {
  localStorage.removeItem("sunreye.dashboard.view");
  await page.viewport(1280, 900);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function show(core: Readonly<Core>, estimated: readonly string[] = []) {
  return render(LiveScene, {
    core,
    pv,
    layout,
    scene,
    moduleTypes: [MODULE],
    capabilities: {
      version: "5.0.0",
      schema: { min: 1, max: 1 },
      capabilities: [],
      transports: [],
      devices: { "1": { estimated: [...estimated], series: [], settings: [], writes: false } },
    },
  });
}

test("each string, the inverter, the grid and the house are labelled from the live values", async () => {
  const { core, tick } = ticking();
  const screen = await show(core);

  await tick(frame(600, -1200));

  await expect.element(screen.getByText("Süd: 600 W")).toBeVisible();
  await expect.element(screen.getByText("Wechselrichter 600 W")).toBeVisible();
  await expect.element(screen.getByText("Einspeisung 1.200 W")).toBeVisible();
  await expect.element(screen.getByText("Hausverbrauch 450 W")).toBeVisible();
});

test("a stale flow is labelled stale", async () => {
  const { core, tick } = ticking();
  const screen = await show(core);

  await tick({ ...frame(600, -1200), stale: { [PLANT]: { "grid.power": 40 } } });

  await expect.element(screen.getByText("Einspeisung 1.200 W")).toBeVisible();
  await expect.element(screen.getByText("veraltet", { exact: true })).toBeVisible();
  expect(screen.getByText("veraltet", { exact: true }).elements()).toHaveLength(1);
});

test("an estimated string carries ≈", async () => {
  const { core, tick } = ticking();
  const screen = await show(core, ["pv.string.power[11]"]);

  await tick(frame(600, 0));

  await expect.element(screen.getByText("Süd: ≈ 600 W")).toBeVisible();
});

/** Draws counted once ten frames pass without one: a tween has run out. */
async function settled(draws: () => number): Promise<number> {
  await expect
    .poll(
      async () => {
        const before = draws();

        await frames(10);

        return draws() - before;
      },
      { timeout: 10_000 },
    )
    .toBe(0);

  return draws();
}

test("a live tick and a camera move draw a short tween, then drawing stops (ADR 20)", async () => {
  // Each draw runs the studio's passes once.
  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const { core, tick } = ticking();
  const screen = await show(core);

  await tick(frame(600, -1200));
  await expect.element(screen.getByText("Süd: 600 W")).toBeVisible();

  const first = await settled(() => draws.mock.calls.length);

  expect(first).toBeGreaterThan(0);

  await tick(frame(700, -1100));
  await expect.element(screen.getByText("Süd: 700 W")).toBeVisible();

  const ticked = await settled(() => draws.mock.calls.length);

  expect(ticked).toBeGreaterThan(first);

  const canvas = screen.getByLabelText("3D-Szene des Hauses");

  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 100, y: 100 },
    targetPosition: { x: 250, y: 100 },
  });

  expect(draws.mock.calls.length).toBeGreaterThan(ticked);
});

test("a car appears at its place while connected, with its charge power and SOC", async () => {
  const { core, tick } = ticking();

  const parked = {
    ...scene,
    carPlaces: [{ device: 2, x: 12, z: 0, width: 2.5, length: 5, rotation: 0 }],
  } satisfies Scene;

  const screen = await render(LiveScene, {
    core,
    pv,
    layout: { ...layout, scene: parked },
    scene: parked,
    moduleTypes: [MODULE],
    capabilities: undefined,
  });

  await tick({ devices: { ...frame(600, 0).devices, "2": { "ev.connected": 0 } } });

  await expect.element(screen.getByText("Süd: 600 W")).toBeVisible();
  expect(screen.getByText(/^Auto/u).elements()).toHaveLength(0);

  await tick({
    devices: { "2": { "ev.connected": 1, "ev.charge.power": 7360, "ev.vehicle.soc": 63 } },
  });

  await expect.element(screen.getByText("Auto lädt 7.360 W")).toBeVisible();
  await expect.element(screen.getByText("Ladestand 63 %")).toBeVisible();
});
