import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import Builder from "./Builder.svelte";
import {
  desk,
  DEVICES,
  drill,
  inspector,
  MODULE,
  onCanvas,
  press,
  pv,
  settle,
  testCore,
  undesk,
} from "./builder.harness.ts";
import { saveFrom } from "./moment.harness.ts";
import { addGrid, type Draft } from "./modules.ts";
import type { Block, Scene } from "./pv.ts";

// A free-form roof in the builder (ADR 20): drawn, its faces taking modules like any other, and
// its block's unused rectangle offered for no edit.

/** An L of 10 m by 8 m, its notch 6 m by 4 m, counter-clockwise seen from above. */
const L: readonly (readonly [number, number])[] = [
  [10, 0],
  [0, 0],
  [0, 8],
  [4, 8],
  [4, 4],
  [10, 4],
];

/** The L under one non-convex face falling 1 m in 4 to the south, an empty grid on it. */
function lHouse(): Draft {
  const block: Block = {
    x: 0,
    z: 0,
    width: 10,
    depth: 8,
    eave: 3,
    rotation: 0,
    roof: { kind: "flat" },
    freeForm: { footprint: L, faces: [L.map(([x, z]) => [x, 5 - z / 4, z])] },
  };

  return {
    scene: addGrid({ north: 0, blocks: [block], obstacles: [] }, 0, 0, MODULE.id),
    strings: [],
  };
}

beforeEach(desk);

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
  await page.viewport(1280, 900);
});

async function opened(draft: Draft, transport: Readonly<Transport> = testCore()): Promise<void> {
  const draws = vi.spyOn(EffectComposer.prototype, "render");

  await render(Builder, {
    pv,
    core: connect(transport),
    start: draft,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await settle(() => draws.mock.calls.length > 0);
}

/** The grid's modules as the last save sent them. */
function saved(transport: { readonly puts: readonly unknown[] }): Scene {
  // SAFETY: the test core keeps what the builder sent, a layout change with its scene.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above.
  return (JSON.parse(JSON.stringify(transport.puts.at(-1))) as { readonly scene: Scene }).scene;
}

test("a free-form block offers its colours and the carport switch, not its unused size and roof", async () => {
  await opened(lHouse());
  await drill("Gebäude", "Baukörper 1");

  await expect.element(inspector().getByRole("group", { name: "Dachfarbe" })).toBeInTheDocument();
  await expect.element(inspector().getByText("Carport")).toBeInTheDocument();

  for (const row of ["Breite (m)", "Tiefe (m)", "Traufhöhe (m)", "Dach"]) {
    expect(inspector().getByText(row, { exact: true }).elements()).toHaveLength(0);
  }
});

test("a tap on the arm of a non-convex free-form face lays a module there, saved with the roof", async () => {
  const draft = lHouse();
  const transport = testCore();

  await opened(draft, transport);
  await drill("Module", "Baukörper 1, Fläche 1");

  // The arm's middle, under the notch's side: 2 m east, 6 m south, 3.5 m up.
  await press("mouse", [onCanvas(draft.scene)([2, 3.5, 6])]);
  await expect.element(inspector().getByText("1 Module gesetzt", { exact: true })).toBeVisible();

  await saveFrom("2026-11-01");
  await expect.poll(() => transport.puts).toHaveLength(1);

  const sent = saved(transport);

  expect(sent.grids?.[0]?.modules).toHaveLength(1);
  expect(sent.blocks[0]?.freeForm).toEqual(draft.scene.blocks[0]?.freeForm);
});
