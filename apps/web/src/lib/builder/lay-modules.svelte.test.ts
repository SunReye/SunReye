import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import Builder from "./Builder.svelte";
import {
  cellsOnPage,
  desk,
  DEVICES,
  drill,
  faceOnPage,
  house,
  inspector,
  MODULE,
  press,
  pv,
  SOUTH,
  choose,
  testCore,
  undesk,
  filledFace,
} from "./builder.harness.ts";
import { saveFrom } from "./moment.harness.ts";
import { addGrid, type Draft } from "./modules.ts";
import type { Scene } from "./pv.ts";

// Modules laid on the roof in 3D (ADR 20): a press on the selected face lays a module where the
// pointer holds its middle, a drag a row, and a drag from a module moves it.

const SLOW = { timeout: 15_000 };

/** The template house with an empty grid on its south face. */
function gridded(): Draft {
  const draft = house();

  return { ...draft, scene: addGrid(draft.scene, 0, 1, MODULE.id) };
}

/** The face level's count of placed modules. */
const count = (placed: number) =>
  inspector().getByText(`${placed} Module gesetzt`, { exact: true });

/** The module level's string row, naming the string the module is wired into. */
const wiredTo = (name: string) =>
  inspector().getByRole("button", { name: `String ${name}`, exact: true });

const undo = () => inspector().getByRole("button", { name: "Rückgängig" }).click();

beforeEach(async () => {
  localStorage.removeItem("sunreye.builder.view");
  await desk();
});

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

  await drill("Module", SOUTH);
  await expect.poll(() => draws.mock.calls.length, SLOW).toBeGreaterThan(0);
}

/** The modules of the south face as the last save sent them, their places in millimetres. */
function saved(transport: { readonly puts: readonly unknown[] }) {
  const put = JSON.stringify(transport.puts.at(-1));
  // SAFETY: the test core keeps what the builder sent, a layout change with its scene.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above.
  const { scene } = JSON.parse(put) as { readonly scene: Scene };

  return (scene.grids?.[0]?.modules ?? []).map(({ across, up, landscape }) => [
    Math.round(across * 1000),
    Math.round(up * 1000),
    landscape,
  ]);
}

test("a tap on the roof lays a module there and a drag across free roof a row, as one undo step each", async () => {
  const draft = gridded();
  const transport = testCore();

  await opened(draft, transport);

  const at = faceOnPage(draft.scene, 0);

  // The pointer holds a portrait module's middle: 0.567 m across and 0.861 m up from its corner.
  await press("mouse", [at(1.067, 1.361)]);
  await expect.element(count(1)).toBeVisible();

  // 3.6 m across: a module and its 2 cm gap fit three times more.
  await press("mouse", [at(3.067, 1.361), at(5, 1.5), at(6.667, 1.5)]);
  await expect.element(count(5)).toBeVisible();

  await saveFrom("2026-11-01");
  await expect.poll(() => transport.puts).toHaveLength(1);
  expect(saved(transport)).toEqual([
    [500, 500, false],
    [2500, 500, false],
    [3654, 500, false],
    [4808, 500, false],
    [5962, 500, false],
  ]);
});

test("a row is one undo step, and a tap where no module fits lays none", async () => {
  const draft = gridded();

  await opened(draft);

  const at = faceOnPage(draft.scene, 0);

  await press("mouse", [at(1.067, 1.361), at(2.5, 1.4), at(4, 1.4)]);
  await expect.element(count(3)).toBeVisible();

  // Over the setback at the eave and at the ridge.
  await press("mouse", [at(5, 0.6)]);
  await press("mouse", [at(7, 4.2)]);
  await expect.element(count(3)).toBeVisible();

  await undo();
  await expect.element(count(0)).toBeVisible();
});

test("a tap on a module selects it, and a drag that starts on one moves it, snapped beside the next", async () => {
  const draft = gridded();
  const transport = testCore();

  await opened(draft, transport);

  const at = faceOnPage(draft.scene, 0);

  await press("mouse", [at(1.067, 1.361)]);
  await press("mouse", [at(5.067, 1.361)]);
  await expect.element(count(2)).toBeVisible();

  // The first module, dragged 2.8 m to the right: 2 cm left of the second, in line with it.
  await press("mouse", [at(1, 1.2), at(2, 1.3), at(3.8, 1.3)]);
  // Onto the second it does not fit, and stays at the last place it did.
  await press("mouse", [at(3.9, 1.2), at(4.6, 1.2), at(5.3, 1.2)]);

  await press("mouse", [at(5, 1.2)]);
  await expect.element(inspector().getByRole("heading", { name: "Modul 2" })).toBeVisible();

  await choose("Ausrichtung", "Quer");
  await inspector().getByRole("checkbox", { name: "Optimierer" }).click();
  await saveFrom("2026-11-01");
  await expect.poll(() => transport.puts).toHaveLength(1);
  expect(saved(transport)).toEqual([
    [3346, 500, false],
    [4500, 500, true],
  ]);

  await inspector().getByRole("button", { name: "Entfernen" }).click();
  await expect.element(count(1)).toBeVisible();
});

test("a module tapped in 3D is wired into a new string or a picked one, or unwired, from its level", async () => {
  const draft = gridded();

  await opened(draft);

  const cells = cellsOnPage(draft.scene, 0);

  await press("mouse", [cells("0.0")]);
  await press("mouse", [cells("0.1")]);
  await expect.element(count(2)).toBeVisible();

  await press("mouse", [cells("0.0")]);
  await expect.element(wiredTo("Keinem String zugeordnet")).toBeVisible();
  await choose("String", "Neuer String");
  await expect.element(wiredTo("String 1")).toBeVisible();

  await press("mouse", [cells("0.1")]);
  await choose("String", "String 1");
  await press("mouse", [cells("0.0")]);
  await choose("String", "Keinem String zugeordnet");
  await expect.element(wiredTo("Keinem String zugeordnet")).toBeVisible();

  await drill("Baukörper 1, Fläche 2", "Module", "Szene", "Strings", "String 1");
  await expect.element(inspector().getByText(/^1 Module, davon 0 mit Optimierer$/u)).toBeVisible();

  await undo();
  await expect.element(inspector().getByText(/^2 Module, davon 0 mit Optimierer$/u)).toBeVisible();
});

test("a chimney moved onto modules removes the ones it covers, in the same undo step", async () => {
  const draft = gridded();

  await opened({ ...draft, scene: filledFace(draft.scene, 0) });
  await expect.element(count(16)).toBeVisible();

  // The first roof face is the north one; moved to the south face it stands in its middle, three
  // fifths up it: on the upper row's fourth and fifth module.
  await drill("Module", "Szene", "Gebäude", "Schornstein hinzufügen");
  await choose("Dachfläche", SOUTH);
  await drill("Gebäude", "Szene", "Module", SOUTH);
  await expect.element(count(14)).toBeVisible();

  await undo();
  await expect.element(count(16)).toBeVisible();
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
