import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import Builder from "./Builder.svelte";
import {
  DEVICES,
  desk,
  drill,
  house,
  inspector,
  MODULE,
  onCanvas,
  pv,
  starts,
  testCore,
  undesk,
} from "./builder.harness.ts";
import { handles } from "./handles/grips.ts";
import type { Scene } from "./pv.ts";
import { fresh } from "./wall-openings.ts";

const SLOW = { timeout: 15_000 };

beforeEach(async () => {
  localStorage.removeItem("sunreye.builder.view");
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
});

/** A mouse drag of opening `index`'s width arrow, 20 cm along its wall. */
async function widen(scene: Scene, index: number): Promise<void> {
  const onPage = onCanvas(scene);

  const arrow = handles(scene, { kind: "opening", index }, pv.modules(scene, {})).find(
    ({ grip }) => grip === "width",
  );

  if (arrow?.axis === undefined) throw new Error("no width arrow");

  const [ax, ay, az] = arrow.at;
  const [x, y] = onPage(arrow.at);
  const [ex, ey] = onPage([ax + arrow.axis[0] * 0.2, ay, az + arrow.axis[2] * 0.2]);
  const mouse = { button: "left" } as const;

  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mousePressed", x, y });
  await cdp().send("Input.dispatchMouseEvent", {
    ...mouse,
    type: "mouseMoved",
    buttons: 1,
    x: ex,
    y: ey,
  });
  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mouseReleased", x: ex, y: ey });
}

test("a window is added on a wall and its width arrow drags it wider, in one undo step", async () => {
  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const start = house();
  const before = start.scene.openings ?? [];

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Gebäude");
  await expect.poll(() => draws.mock.calls.length, SLOW).toBeGreaterThan(0);

  await inspector().getByRole("button", { name: "Fenster hinzufügen" }).click();

  const width = inspector().getByRole("button", { name: starts("Breite (m)") });
  const undo = inspector().getByRole("button", { name: "Rückgängig" });

  // The new window's own level, in its usual size.
  await expect.element(width.getByText(/^1,2$/u)).toBeVisible();

  // The scene as the builder now holds it: the template's openings and the new one after them.
  const made = fresh(pv, start.scene, "window");

  if (made === null) throw new Error("no room for a window");

  // Up to the front door, 30 cm on, there is room for it.
  const wider = width.getByText(/^1,[345]$/u);

  // A press before the handles' first draw grabs nothing: it is made again until one lands.
  await expect
    .poll(async () => {
      if (wider.query() === null) {
        await widen({ ...start.scene, openings: [...before, made] }, before.length);
      }

      return wider.query() !== null;
    }, SLOW)
    .toBe(true);

  await undo.click();

  await expect.element(width.getByText(/^1,2$/u)).toBeVisible();
});
