import "../../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect } from "../../api/core.ts";
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
  pv,
  starts,
  testCore,
  undesk,
} from "../builder.harness.ts";
import { handles, type Target, type Triple } from "./grips.ts";

type Scene = ReturnType<typeof house>["scene"];

const SLOW = { timeout: 15_000 };

beforeEach(async () => {
  localStorage.removeItem("sunreye.builder.view");
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
});

/** A mouse drag of the first block's width arrow, two metres outward. */
async function widen(start: Scene): Promise<void> {
  const onPage = onCanvas(start);
  const arrow = handles(start, { kind: "block", index: 0 }).find(({ grip }) => grip === "width");

  if (arrow?.axis === undefined) throw new Error("no width arrow");

  const [ax, ay, az] = arrow.at;
  const [x, y] = onPage(arrow.at);
  const [ex, ey] = onPage([ax + arrow.axis[0] * 2, ay, az + arrow.axis[2] * 2]);
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

test("dragging a block's width arrow is one undo step; the inspector shows the new width", async () => {
  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const start = house();

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Gebäude", "Baukörper 1");
  await expect.poll(() => draws.mock.calls.length, SLOW).toBeGreaterThan(0);
  await widen(start.scene);

  const width = inspector().getByRole("button", { name: starts("Breite (m)") });
  const undo = inspector().getByRole("button", { name: "Rückgängig" });

  await expect.element(width.getByText(/^1[12](,\d)?$/u)).toBeVisible();

  await undo.click();

  await expect.element(width.getByText(/^10$/u)).toBeVisible();
  await expect.element(undo).toBeDisabled();
});

/** The house with a car place on the lawn west of it, linked to the wallbox. */
function parked() {
  const start = house();

  return {
    ...start,
    scene: {
      ...start.scene,
      carPlaces: [{ device: 3, x: -5, z: 1, width: 2.5, length: 5, rotation: 0 }],
    },
  };
}

/** High over the house and the lawn around it: the presets frame the house alone. */
const ABOVE: View = { position: [2, 45, 4.05], target: [2, 0, 4] };

/** A mouse press at `from`, moved to `to`, both three.js points seen from `ABOVE`, let go there. */
async function mouseDrag(start: Scene, from: Triple, to: Triple): Promise<void> {
  const onPage = onCanvas(start, ABOVE);
  const [[x, y], [ex, ey]] = [onPage(from), onPage(to)];
  const mouse = { button: "left" } as const;
  const [mx, my] = [(x + ex) / 2, (y + ey) / 2];

  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mousePressed", x, y });

  for (const [px, py] of [
    [mx, my],
    [ex, ey],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- a pointer moves one step at a time.
    await cdp().send("Input.dispatchMouseEvent", {
      ...mouse,
      type: "mouseMoved",
      buttons: 1,
      x: px,
      y: py,
    });
  }

  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mouseReleased", x: ex, y: ey });
}

test("dragging a car place moves it in one undo step; its ring turns it", SLOW, async () => {
  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const start = parked();
  const place: Target = { kind: "place", index: 0 };

  localStorage.setItem("sunreye.builder.view", JSON.stringify(ABOVE));

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Geräte", "Stellplatz 1");
  await expect.poll(() => draws.mock.calls.length, SLOW).toBeGreaterThan(0);
  await mouseDrag(start.scene, [-3.75, 0, 3.5], [-3.75, 0, 5.5]);

  const z = inspector().getByRole("button", { name: starts("Position z (m)") });
  const undo = inspector().getByRole("button", { name: "Rückgängig" });

  await expect.element(z.getByText(/^[23](,\d)?$/u)).toBeVisible();

  await undo.click();

  await expect.element(z.getByText(/^1$/u)).toBeVisible();
  await expect.element(undo).toBeDisabled();

  const ring = handles(start.scene, place).find(({ grip }) => grip === "turn");

  if (ring?.radius === undefined) throw new Error("no ring");

  const [cx, , cz] = ring.at;

  await mouseDrag(start.scene, [cx + ring.radius, 0, cz], [cx, 0, cz + ring.radius]);

  const rotation = inspector().getByRole("button", { name: starts("Drehung (°)") });

  await expect.element(rotation.getByText(/^90$/u)).toBeVisible();
});
