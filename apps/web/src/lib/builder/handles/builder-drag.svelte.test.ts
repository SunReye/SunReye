import "../../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect } from "../../api/core.ts";
import Builder from "../Builder.svelte";
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
import { handles } from "./grips.ts";

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
