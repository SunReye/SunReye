import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Builder from "../../../../../packages/builder/src/builder/Builder.svelte";
import {
  DEVICES,
  faceOnPage,
  hosted,
  house,
  MODULE,
  ontoFace,
  phone,
  press,
  pv,
  settle,
  SOUTH,
  starts,
  tap,
  testCore,
  undesk,
} from "./builder.harness.ts";
import { addGrid, type Draft } from "../../../../../packages/builder/src/builder/modules.ts";

// Modules laid on the roof with a finger (ADR 20 Touch): a gesture that starts on the selected face
// lays, a second finger hands both to the camera.

/** The template house with an empty grid on its south face. */
function gridded(): Draft {
  const draft = house();

  return { ...draft, scene: addGrid(draft.scene, 0, 1, MODULE.id) };
}

beforeEach(() => {
  localStorage.removeItem("sunreye.builder.view");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
  await page.viewport(1280, 900);
});

/** The fingers at `points`, through the browser's touch input; each keeps its id by position. */
async function touch(
  type: "touchStart" | "touchMove" | "touchEnd",
  points: readonly (readonly [number, number])[],
): Promise<void> {
  await cdp().send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map(([x, y], id) => ({ x, y, id })),
  });
}

/** Two fingers: the first presses `one` and moves to `two`, then a second joins and both move. */
async function pinch(
  one: readonly [number, number],
  two: readonly [number, number],
): Promise<void> {
  await touch("touchStart", [one]);
  await touch("touchMove", [two]);
  await touch("touchStart", [two, [two[0] + 80, two[1] + 80]]);
  await touch("touchMove", [
    [two[0] - 40, two[1] - 40],
    [two[0] + 140, two[1] + 140],
  ]);
  await touch("touchEnd", []);
}

/** A phone's inspector sheet, and the handle that pulls it up. */
const sheet = () => page.getByRole("region", { name: "Szene bearbeiten" });
const handle = () => page.getByRole("button", { name: "Szene bearbeiten" });

/** Taps a row or button of the pulled-up sheet whose name starts with `label`. */
async function row(label: string): Promise<void> {
  const button = sheet()
    .getByRole("button", { name: starts(label) })
    .first();

  await expect.element(button).toBeVisible();
  await tap(button);
}

test("on a phone a finger lays a row on the selected face and a tap selects one; a second finger orbits", async () => {
  await phone();

  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const draft = gridded();

  await render(Builder, {
    pv,
    ...hosted(testCore()),
    start: draft,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await tap(handle());
  await row("Module");
  await row(SOUTH);
  await tap(handle());
  await settle(() => draws.mock.calls.length > 0);

  // The camera flew onto the face when it was opened.
  const at = faceOnPage(draft.scene, 0, ontoFace(draft.scene, 0));

  // A finger's drag lays a row of three; a tap on its second module selects it.
  await press("touch", [at(1.067, 1.361), at(2.5, 1.4), at(3.6, 1.4)]);
  await press("touch", [at(2.2, 1.4)]);
  await expect.element(sheet().getByRole("heading", { name: "Modul 2" })).toBeInTheDocument();

  // A second finger puts its row back and turns the camera instead.
  await pinch(at(5.067, 1.361), at(7, 1.4));
  await expect.poll(() => localStorage.getItem("sunreye.builder.view")).not.toBeNull();

  await tap(handle());
  await row("Baukörper 1, Fläche 2");
  await expect.element(sheet().getByText("3 Module gesetzt", { exact: true })).toBeVisible();
});
