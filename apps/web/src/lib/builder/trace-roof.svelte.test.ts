import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
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
