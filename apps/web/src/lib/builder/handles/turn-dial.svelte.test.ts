import "../../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect } from "../../api/core.ts";
import { haptics } from "../../haptics.ts";
import Builder from "../Builder.svelte";
import type { View } from "../camera.ts";
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
} from "../builder.harness.ts";
import { offered } from "./offered.ts";

const SLOW = { timeout: 15_000 };
const VIEW = "sunreye.builder.view";

/** Straight above the house's middle, north up. */
const ABOVE: View = { position: [5, 45, 4.05], target: [5, 0, 4] };

beforeEach(async () => {
  localStorage.removeItem(VIEW);
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
});

const rotation = () => inspector().getByRole("button", { name: starts("Drehung (°)") });
const undo = () => inspector().getByRole("button", { name: "Rückgängig" });

const tool = (name: string) =>
  page.getByRole("toolbar", { name: "Aktionen" }).getByRole("button", { name });

/** The builder with the template house picked, turned by `turn`, seen from `view`. */
async function picked(turn = 0, view?: View) {
  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const { scene, strings } = house();
  const [block] = scene.blocks;

  if (block === undefined) throw new Error("no block");

  const start = { strings, scene: { ...scene, blocks: [{ ...block, rotation: turn }] } };

  if (view !== undefined) localStorage.setItem(VIEW, JSON.stringify(view));

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });
  await drill("Gebäude", "Baukörper 1");
  await expect.poll(() => draws.mock.calls.length, SLOW).toBeGreaterThan(0);

  return { scene: start.scene, onPage: onCanvas(start.scene, view) };
}

/** A page point low on the canvas at its left, clear of the toolbar: the dial is anywhere. */
function low(): [number, number] {
  const canvas = page.getByLabelText("3D-Szene des Hauses").element().getBoundingClientRect();

  return [canvas.left + 120, canvas.bottom - 160];
}

/** A press at a page point dragged by each of `steps`, in pixels from it. */
const path = ([x, y]: readonly [number, number], steps: readonly (readonly [number, number])[]) =>
  [[0, 0] as const, ...steps].map(([dx, dy]): [number, number] => [x + dx, y + dy]);

test("the dial waits for 8 px sideways: a swipe up and down turns nothing, re-snaps nothing, records nothing", async () => {
  // An angle typed in the inspector, off the 5° steps.
  await picked(187.3);

  await tool("Drehen").click();
  await press(
    "mouse",
    path(low(), [
      [2, -30],
      [-3, -60],
      [4, -90],
    ]),
  );

  await expect.element(rotation().getByText(/^187,3$/u)).toBeVisible();
  await expect.element(undo()).toBeDisabled();
});

test("each snapped step of a turn is felt, and only those", async () => {
  await picked();

  const ticks = vi.spyOn(haptics, "selection");

  await tool("Drehen").click();
  ticks.mockClear();
  // 10° a step: 350°, 340°, 340° again, 330°.
  await press(
    "mouse",
    path(low(), [
      [20, 0],
      [40, 0],
      [44, 0],
      [60, 0],
    ]),
  );

  await expect.element(rotation().getByText(/^330$/u)).toBeVisible();
  expect(ticks).toHaveBeenCalledTimes(3);
});

test("seen from above, what is under the pointer follows it on either side of the house's middle", async () => {
  const { onPage } = await picked(0, ABOVE);

  await tool("Drehen").click();
  // South of the middle, to the right: against the clock.
  await press(
    "mouse",
    path(onPage([5, 0, 10]), [
      [40, 0],
      [80, 0],
    ]),
  );
  await expect.element(rotation().getByText(/^320$/u)).toBeVisible();

  // North of it, to the right: with the clock, back to where it stood.
  await press(
    "mouse",
    path(onPage([5, 0, -2]), [
      [40, 0],
      [80, 0],
    ]),
  );
  await expect.element(rotation().getByText(/^0$/u)).toBeVisible();
});

test("a 6 px slip on the knob or on an arrow leaves the house as it stood, with nothing to undo", async () => {
  const { scene, onPage } = await picked();
  const found = offered(scene, { kind: "block", index: 0 }, pv.modules(scene, {}), false);
  const knob = found.find(({ grip }) => grip === "carry");
  const arrow = found.find(({ grip }) => grip === "width");

  if (knob === undefined || arrow === undefined) throw new Error("no handles");

  await press(
    "mouse",
    path(onPage(knob.at), [
      [3, 0],
      [6, 0],
    ]),
  );
  await press(
    "touch",
    path(onPage(arrow.at), [
      [0, 3],
      [0, 6],
    ]),
  );

  await expect
    .element(
      inspector()
        .getByRole("button", { name: starts("Position x (m)") })
        .getByText(/^0$/u),
    )
    .toBeVisible();
  await expect
    .element(
      inspector()
        .getByRole("button", { name: starts("Breite (m)") })
        .getByText(/^10$/u),
    )
    .toBeVisible();
  await expect.element(undo()).toBeDisabled();
});
