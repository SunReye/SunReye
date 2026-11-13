import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
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
  press,
  pv,
  SOUTH,
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
