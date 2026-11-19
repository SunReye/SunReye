import "../../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect } from "../../api/core.ts";
import Builder from "../Builder.svelte";
import {
  DEVICES,
  desk,
  drill,
  house,
  inspector,
  MODULE,
  onCanvas,
  press,
  pv,
  starts,
  testCore,
  undesk,
  type Pointer,
} from "../builder.harness.ts";
import { handles } from "./grips.ts";
import { offered } from "./offered.ts";

const SLOW = { timeout: 15_000 };
const VIEW = "sunreye.builder.view";

beforeEach(async () => {
  localStorage.removeItem(VIEW);
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
});

/** The builder with the template house's block picked, as a tap on it leaves it. */
async function picked() {
  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const start = house();

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });
  await drill("Gebäude", "Baukörper 1");
  await expect.poll(() => draws.mock.calls.length, SLOW).toBeGreaterThan(0);

  return start.scene;
}

/** An orbit's worth of travel from a page point: 80 px to the right, in steps. */
const swipe = ([x, y]: readonly [number, number]) =>
  [0, 20, 40, 60, 80].map((dx): [number, number] => [x + dx, y]);

/** Nothing was dragged: the block stands as it stood, with nothing to undo, and the view turned. */
async function orbited(): Promise<void> {
  await expect.poll(() => localStorage.getItem(VIEW), SLOW).not.toBeNull();
  await expect
    .element(
      inspector()
        .getByRole("button", { name: starts("Drehung (°)") })
        .getByText(/^0$/u),
    )
    .toBeVisible();
  await expect.element(inspector().getByRole("button", { name: "Rückgängig" })).toBeDisabled();
}

test.each<Pointer>(["mouse", "touch"])(
  "a %s drag from the ground beside a picked house orbits: the house is not turned",
  async (pointer) => {
    const scene = await picked();
    const ring = handles(scene, { kind: "block", index: 0 }).find(({ grip }) => grip === "turn");

    if (ring?.radius === undefined) throw new Error("no ring");

    // Where the ring lay on the ground, east of the house.
    await press(pointer, swipe(onCanvas(scene)([ring.at[0] + ring.radius, 0, ring.at[2]])));
    await orbited();
  },
);

test.each<Pointer>(["mouse", "touch"])(
  "a %s drag that starts on a picked house orbits: the house is not moved",
  async (pointer) => {
    const scene = await picked();

    // Its front wall, a metre and a half up.
    await press(pointer, swipe(onCanvas(scene)([2, 1.5, 8])));
    await orbited();
  },
);

test.each<Pointer>(["mouse", "touch"])(
  "a %s drag of the knob before a picked house's front wall moves the house, one undo step",
  async (pointer) => {
    const scene = await picked();

    const knob = offered(scene, { kind: "block", index: 0 }, pv.modules(scene, {}), false).find(
      ({ grip }) => grip === "carry",
    );

    if (knob === undefined) throw new Error("no knob");

    const [x, y, z] = knob.at;
    const onPage = onCanvas(scene);

    // Two metres east along the ground.
    await press(pointer, [onPage(knob.at), onPage([x + 1, y, z]), onPage([x + 2, y, z])]);

    const east = inspector().getByRole("button", { name: starts("Position x (m)") });
    const undo = inspector().getByRole("button", { name: "Rückgängig" });

    await expect.element(east.getByText(/^[1-4](,\d)?$/u)).toBeVisible();
    await undo.click();
    await expect.element(east.getByText(/^0$/u)).toBeVisible();
    await expect.element(undo).toBeDisabled();
  },
);

test("while strings are wired a drag from the house orbits: a block has handles on its own level only", async () => {
  const scene = await picked();

  await drill("Gebäude", "Szene", "Strings");
  await press("mouse", swipe(onCanvas(scene)([2, 1.5, 8])));
  await expect.poll(() => localStorage.getItem(VIEW), SLOW).not.toBeNull();
  await expect.element(inspector().getByRole("button", { name: "Rückgängig" })).toBeDisabled();
});
