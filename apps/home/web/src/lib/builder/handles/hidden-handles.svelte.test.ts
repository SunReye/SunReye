import "../../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Builder from "../../../../../../../packages/builder/src/builder/Builder.svelte";
import type { View } from "../../../../../../../packages/builder/src/builder/camera.ts";
import {
  desk,
  DEVICES,
  drill,
  hosted,
  house,
  inspector,
  MODULE,
  onCanvas,
  press,
  pv,
  settle,
  testCore,
  undesk,
  undrawn,
} from "../builder.harness.ts";
import { offered } from "../../../../../../../packages/builder/src/builder/handles/offered.ts";

const VIEW = "sunreye.builder.view";

/** Low behind the house, north of it: its front wall and all before it are out of sight. */
const BEHIND: View = { position: [5, 3, -25], target: [5, 2, 4] };

beforeEach(async () => {
  localStorage.removeItem(VIEW);
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
});

/** The builder with the bare-walled template house picked, seen from `view` or the first view. */
async function picked(view?: View) {
  const draws = undrawn();
  const { scene, strings } = house();
  const start = { strings, scene: { ...scene, openings: [] } };

  if (view !== undefined) localStorage.setItem(VIEW, JSON.stringify(view));

  await render(Builder, {
    pv,
    ...hosted(testCore()),
    start,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });
  await drill("Gebäude", "Baukörper 1");
  await settle(() => draws.mock.calls.length > 0);

  return {
    scene: start.scene,
    onPage: onCanvas(start.scene, view),
    kept: localStorage.getItem(VIEW),
  };
}

const swipe = ([x, y]: readonly [number, number]) =>
  [0, 20, 40, 60, 80].map((dx): [number, number] => [x + dx, y]);

const add = () =>
  page.getByRole("toolbar", { name: "Aktionen" }).getByRole("button", { name: "Hinzufügen" });

/** The view turned and nothing was dragged. */
async function orbited(kept: string | null): Promise<void> {
  await settle(() => localStorage.getItem(VIEW) !== kept);
  await expect.element(inspector().getByRole("button", { name: "Rückgängig" })).toBeDisabled();
}

test("a tap on the middle of a picked house's front wall picks the spot, and a drag from there orbits", async () => {
  const { onPage, kept } = await picked();

  // Where a door goes: no handle stands before it.
  await press("mouse", [onPage([5, 1.2, 8])]);
  await expect.element(add()).toBeVisible();

  await press("mouse", swipe(onPage([5, 1.2, 8])));
  await orbited(kept);
});

test("from behind, the middle of the back wall is a spot too, and a drag from it orbits", async () => {
  const { onPage, kept } = await picked(BEHIND);

  await press("mouse", [onPage([5, 1.2, 0])]);
  await expect.element(add()).toBeVisible();

  await press("mouse", swipe(onPage([5, 1.2, 0])));
  await orbited(kept);
});

test("a handle the house hides is not grabbed: a drag over the hidden knob orbits", async () => {
  const { scene, onPage, kept } = await picked(BEHIND);

  const hidden = offered(scene, { kind: "block", index: 0 }, pv.modules(scene, {}), false).filter(
    ({ grip, at }) => at[2] > 8 && grip !== "move",
  );

  // The knob and the depth arrow stand before the front wall.
  expect(hidden.map(({ grip }) => grip).toSorted()).toEqual(["carry", "depth"]);

  for (const handle of hidden) {
    // oxlint-disable-next-line no-await-in-loop -- one drag at a time.
    await press("mouse", swipe(onPage(handle.at)));
  }

  await orbited(kept);
});
