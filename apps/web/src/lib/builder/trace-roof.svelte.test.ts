import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Builder from "../../../../../packages/builder/src/builder/Builder.svelte";
import { parseView } from "../../../../../packages/builder/src/builder/camera.ts";
import {
  DEVICES,
  desk,
  drill,
  hosted,
  house,
  inspector,
  MODULE,
  press,
  pv,
  settle,
  testCore,
  undesk,
} from "./builder.harness.ts";
import { finish } from "../motion/animations.harness.ts";
import { onView } from "./projection.harness.ts";

// Home's builder traces a roof (ADR 20): the Buildings group starts the tracing mode, the canvas
// turns to look down, clicks trace a new roof over the plot, and Done leaves the mode.

beforeEach(async () => {
  localStorage.removeItem("sunreye.builder.view");
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
});

/** The builder on the template house, in the tracing mode once the canvas has turned down. */
async function tracing(): Promise<void> {
  const draws = vi.spyOn(EffectComposer.prototype, "render");

  await render(Builder, {
    pv,
    ...hosted(testCore()),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Gebäude");
  await inspector().getByRole("button", { name: "Dach nachzeichnen" }).click();

  const drawn = draws.mock.calls.length;

  await settle(() => draws.mock.calls.length > drawn);
}

test("a roof traced from above is a new block, and Done leaves the tracing", async () => {
  await tracing();

  const bar = page.getByRole("toolbar", { name: "Dach nachzeichnen" });

  await expect.element(bar).toBeVisible();

  const view = parseView(localStorage.getItem("sunreye.builder.view"));
  const canvas = page.getByLabelText("3D-Szene des Hauses").element().getBoundingClientRect();

  if (view === undefined) throw new Error("no view from above was kept");

  const at = onView(view, canvas);

  for (const [x, z] of [
    [2, 2],
    [2, 6],
    [6, 6],
    [6, 2],
    [2, 2],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one click after another, as the person traces.
    await press("mouse", [at([x, 0, z])]);
  }

  await bar.getByRole("button", { name: "Fertig" }).click();

  await expect.element(bar).not.toBeInTheDocument();
  await expect
    .element(
      inspector()
        .getByRole("button", { name: /^Baukörper 2/u })
        .first(),
    )
    .toBeVisible();
});

/** The tracing bar. */
const bar = () => page.getByRole("toolbar", { name: "Dach nachzeichnen" });

/** Types `value` into the bar's height `name` and applies it. */
async function height(name: string, value: string): Promise<void> {
  await bar()
    .getByRole("button", { name: new RegExp(`^${name} `, "u") })
    .click();
  await page.getByRole("button", { name: /tippen zum Eingeben/u }).click();
  await userEvent.fill(page.getByRole("textbox", { name: `${name} eingeben` }), value);
  await userEvent.keyboard("{Enter}");

  const apply = page.getByRole("button", { name: /^Übernehmen/u });

  await apply.click();
  await finish(() => apply.query() === null);
}

test("a traced gable is pulled up by its eaves and ridge, and a point raised by number bends a face", async () => {
  await tracing();

  const view = parseView(localStorage.getItem("sunreye.builder.view"));
  const canvas = page.getByLabelText("3D-Szene des Hauses").element().getBoundingClientRect();

  if (view === undefined) throw new Error("no view from above was kept");

  const at = onView(view, canvas);

  // The outline with a point at each verge's middle, then the ridge between them.
  for (const [x, z] of [
    [2, 2],
    [2, 4],
    [2, 6],
    [10, 6],
    [10, 4],
    [10, 2],
    [2, 2],
    [2, 4],
    [10, 4],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one click after another, as the person traces.
    await press("mouse", [at([x, 0, z])]);
  }

  await userEvent.keyboard("{Escape}");
  await height("Traufhöhe", "3");
  await height("Firsthöhe", "6");

  await expect.element(bar().getByRole("button", { name: /^Traufhöhe 3 m/u })).toBeVisible();
  await expect.element(bar().getByRole("button", { name: /^Firsthöhe 6 m/u })).toBeVisible();

  // The ridge is picked where it stands now, 6 m up, off-centre: not over the ground under it.
  await press("mouse", [at([8, 6, 4])]);

  await expect
    .element(bar().getByRole("radio", { name: "First" }))
    .toHaveAttribute("aria-checked", "true");

  await height("Höhe Ende", "5");

  await expect
    .element(bar().getByRole("status"))
    .toHaveTextContent("Eine Dachfläche ist nicht eben und trägt keine Module, bis sie es ist.");
});

/** Picks ready shape `name` from the bar's menu. */
async function ready(name: string): Promise<void> {
  await bar().getByRole("button", { name: "Fertige Form" }).click();
  await page.getByRole("menuitem", { name }).click();
}

test("a ready roof and a ready dormer are placed by a click each, and the dormer is raised", async () => {
  await tracing();

  const view = parseView(localStorage.getItem("sunreye.builder.view"));
  const canvas = page.getByLabelText("3D-Szene des Hauses").element().getBoundingClientRect();

  if (view === undefined) throw new Error("no view from above was kept");

  const at = onView(view, canvas);

  await ready("Satteldach");
  await expect.element(bar().getByText("Tippe auf die Stelle für: Satteldach")).toBeVisible();

  // 10 m by 8 m, centred on (6, 4): its front face rises from z 0, at 3 m, to its ridge at z 4.
  await press("mouse", [at([6, 0, 4])]);

  await expect.element(bar().getByRole("button", { name: /^Firsthöhe 7 m/u })).toBeVisible();

  await ready("Schleppgaube");
  await expect.element(bar().getByText("Tippe auf die Dachfläche für: Schleppgaube")).toBeVisible();

  // 2 m by 1.5 m, centred on (6, 2): its front at z 1.25 on the face at 4.25 m, its eave at 5 m.
  await press("mouse", [at([6, 0, 2])]);
  await expect.element(bar().getByText(/Tippe auf/u)).not.toBeInTheDocument();

  await press("mouse", [at([6, 5, 1.25])]);
  await expect.element(bar().getByRole("button", { name: /^Gaube Traufe 5 m/u })).toBeVisible();

  await height("Gaube Traufe", "4,5");

  await expect.element(bar().getByRole("button", { name: /^Gaube Traufe 4,5 m/u })).toBeVisible();
});

test("a ready shape held is let go by Abbrechen, and nothing is placed", async () => {
  await tracing();
  await ready("Walmdach");
  await bar().getByRole("button", { name: "Abbrechen" }).click();

  await expect.element(bar().getByText(/Tippe auf/u)).not.toBeInTheDocument();
  await expect.element(bar().getByRole("button", { name: /^Traufhöhe/u })).not.toBeInTheDocument();
});
