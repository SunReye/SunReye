import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { StringDraft } from "../api/core.ts";
import Builder from "./Builder.svelte";
import {
  desk,
  DEVICES,
  drill,
  house,
  inspector,
  MODULE,
  onCanvas,
  press,
  pv,
  testCore,
  undesk,
  type Pointer,
} from "./builder.harness.ts";
import { connect } from "../api/core.ts";
import { addGrid, fillGrid, panels, type Draft } from "./modules.ts";
import { toThree } from "./scene.ts";

const SLOW = { timeout: 15_000 };

const SIZES = { [MODULE.id]: { width: MODULE.width, height: MODULE.height } };

const OTHER = { ...MODULE, id: 8, name: "Other 300" };

function wired(name: string, moduleType: number): StringDraft {
  return {
    name,
    moduleType,
    device: 1,
    input: 1,
    modules: 0,
    optimized: 0,
    tilt: 0,
    azimuth: 0,
    loss: 2,
  };
}

/** The template house with both roof faces filled with unassigned modules. */
function filled(strings: readonly Readonly<StringDraft>[]): Draft {
  const { scene } = house();
  let gridded = addGrid(addGrid(scene, 0, 0, MODULE.id), 0, 1, MODULE.id);
  const laid = pv.modules(gridded, SIZES).grids;

  gridded = fillGrid(fillGrid(gridded, 0, laid[0] ?? []), 1, laid[1] ?? []);

  return { scene: gridded, strings };
}

/** Each module's centre on the page, in the order the canvas draws them. */
function centres(draft: Draft): [number, number][] {
  const onPage = onCanvas(draft.scene);
  const laid = pv.modules(draft.scene, SIZES).grids;

  return panels(draft.scene, laid).map(({ corners }) => {
    const sum = corners.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);

    return onPage(toThree([sum[0] / 4, sum[1] / 4, sum[2] / 4]));
  });
}

/** The modules a string's row summarises, as the strings group lists them. */
const made = (count: number) =>
  inspector().getByText(new RegExp(`^${count} Module, davon 0 mit Optimierer$`, "u"));

beforeEach(async () => {
  localStorage.removeItem("sunreye.builder.view");
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
});

async function opened(draft: Draft) {
  const draws = vi.spyOn(EffectComposer.prototype, "render");

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: draft,
    moduleTypes: [MODULE, OTHER],
    devices: DEVICES,
  });

  await drill("Strings", draft.strings[0]?.name ?? "");
  await expect.poll(() => draws.mock.calls.length, SLOW).toBeGreaterThan(0);
}

/** Three neighbouring modules of the face nearest the isometric camera. */
function three(draft: Draft): [number, number][] {
  const all = centres(draft);
  // The north face fills first: the south face's first row follows it.
  const south = pv.modules(draft.scene, SIZES).grids[0]?.length ?? 0;

  return all.slice(south, south + 3);
}

test.each<Pointer>(["mouse", "touch"])(
  "a %s drag across modules in 3D paints them into the picked string, as one undo step",
  async (pointer) => {
    const draft = filled([wired("Süd", MODULE.id)]);

    await opened(draft);
    await press(pointer, three(draft));

    await expect.element(made(3)).toBeVisible();

    await inspector().getByRole("button", { name: "Rückgängig" }).click();

    await expect.element(made(0)).toBeVisible();
  },
);

test("painting a string of another module type in 3D is refused beside the pointer", async () => {
  const draft = filled([wired("Ost", OTHER.id)]);

  await opened(draft);
  await press("mouse", three(draft).slice(0, 1));

  await expect
    .element(page.getByRole("alert").filter({ hasText: "Ost hat einen anderen Modultyp" }))
    .toBeVisible();
  await expect.element(made(0)).toBeVisible();
});
