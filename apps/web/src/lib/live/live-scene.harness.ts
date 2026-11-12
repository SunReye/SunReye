// What the live scene's component tests share: a plant, a ticking core and the chips' names.
import { expect } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Core, type Layout, type Transport, type Values } from "../api/core.ts";
import { MODULE, pv } from "../builder/builder.harness.ts";
import type { Scene } from "../builder/pv.ts";
import "../../app.css";
import { PLANT } from "./labels.ts";
import LiveScene from "./LiveScene.svelte";

/** A 10 m × 8 m gable house: two modules of string 0 on the south face, an inverter marker. */
export const scene = {
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

export const layout: Layout = {
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

export interface Ticking {
  readonly core: Core;
  /** Sends a snapshot first, then deltas. */
  readonly tick: (live: Values) => Promise<void>;
}

/** A core whose live stream sends what the test ticks. */
export function ticking(): Ticking {
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

export function frame(string: number, grid: number): Values {
  return {
    devices: {
      "1": { "pv.string.power[11]": string, "pv.power": string },
      [PLANT]: { "grid.power": grid, "load.power": 450 },
    },
  };
}

export function show(
  core: Readonly<Core>,
  estimated: readonly string[] = [],
  onselect: (id: string) => void = () => {},
) {
  return render(LiveScene, {
    core,
    onselect,
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

/** The chip named `name`, once its value has glided to `value`. */
export async function chip(name: string, value: string) {
  const button = page.getByRole("button", { name: `${name}: Details` });

  await expect.element(button.getByText(value, { exact: true })).toBeVisible();

  return button;
}
