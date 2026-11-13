import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import Builder from "./Builder.svelte";
import {
  cellsOnPage,
  desk,
  DEVICES,
  drill,
  house,
  inspector,
  MODULE,
  phone,
  press,
  pv,
  SOUTH,
  starts,
  tap,
  testCore,
  undesk,
} from "./builder.harness.ts";
import { addGrid, type Draft } from "./modules.ts";

// Modules placed on the roof in 3D (ADR 20): a face's free cells show on it while it is selected.

const SLOW = { timeout: 15_000 };

/** The template house with an empty grid on its south face. */
function gridded(): Draft {
  const draft = house();

  return { ...draft, scene: addGrid(draft.scene, 0, 1, MODULE.id) };
}

/** The face level's count of placed modules. */
const count = (placed: number) =>
  inspector().getByText(new RegExp(`^${placed} von 16 Modulen gesetzt$`, "u"));

beforeEach(async () => {
  localStorage.removeItem("sunreye.builder.view");
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
  await page.viewport(1280, 900);
});

async function opened(draft: Draft): Promise<void> {
  const draws = vi.spyOn(EffectComposer.prototype, "render");

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: draft,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Module", SOUTH);
  await expect.poll(() => draws.mock.calls.length, SLOW).toBeGreaterThan(0);
}

test("a drag across three free cells on the roof places three modules, as one undo step", async () => {
  const draft = gridded();

  await opened(draft);

  const cells = cellsOnPage(draft.scene, 0);

  await press("mouse", [cells("0.0"), cells("0.1"), cells("0.2")]);

  await expect.element(count(3)).toBeVisible();

  await inspector().getByRole("button", { name: "Rückgängig" }).click();

  await expect.element(count(0)).toBeVisible();
});

test("a tap on a placed module selects it, and a drag that starts on one removes a run", async () => {
  const draft = gridded();

  await opened(draft);

  const cells = cellsOnPage(draft.scene, 0);
  const at = (...keys: readonly string[]) => keys.map((key) => cells(key));

  await press("mouse", at("0.0", "0.1", "0.2", "0.3"));
  await expect.element(count(4)).toBeVisible();

  await press("mouse", at("0.2", "0.3"));
  await expect.element(count(2)).toBeVisible();

  await press("mouse", at("0.1"));
  await expect
    .element(inspector().getByRole("heading", { name: "Reihe 1, Spalte 2" }))
    .toBeVisible();

  await inspector().getByRole("checkbox", { name: "Optimierer" }).click();
  await inspector().getByRole("button", { name: "Entfernen" }).click();

  await expect.element(count(1)).toBeVisible();
});

test("a drag that starts off the roof orbits the camera and places nothing", async () => {
  const draft = gridded();

  await opened(draft);

  const canvas = page.getByLabelText("3D-Szene des Hauses").element().getBoundingClientRect();
  const [left, top] = [canvas.left + 30, canvas.top + canvas.height * 0.8];

  await press("mouse", [
    [left, top],
    [left + 60, top + 10],
    [left + 120, top + 20],
  ]);

  await expect.poll(() => localStorage.getItem("sunreye.builder.view")).not.toBeNull();
  await expect.element(count(0)).toBeVisible();
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

test("on a phone a finger lays a run on the selected face and a tap selects one; a second finger orbits", async () => {
  await phone();

  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const draft = gridded();

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: draft,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await tap(handle());
  await row("Module");
  await row(SOUTH);
  await tap(handle());
  await expect.poll(() => draws.mock.calls.length, SLOW).toBeGreaterThan(0);

  const at = cellsOnPage(draft.scene, 0);

  await press("touch", [at("0.0"), at("0.1"), at("0.2")]);
  await press("touch", [at("0.1")]);
  await expect
    .element(sheet().getByRole("heading", { name: "Reihe 1, Spalte 2" }))
    .toBeInTheDocument();

  // A second finger puts its run back and turns the camera instead.
  await pinch(at("0.4"), at("0.5"));
  await expect.poll(() => localStorage.getItem("sunreye.builder.view")).not.toBeNull();

  await tap(handle());
  await row("Baukörper 1, Fläche 2");
  await expect.element(sheet().getByText("3 von 16 Modulen gesetzt")).toBeVisible();
}, 60_000);
