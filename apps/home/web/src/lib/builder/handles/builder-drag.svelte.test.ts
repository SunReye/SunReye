import "../../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Builder from "../../../../../../../packages/builder/src/builder/Builder.svelte";
import type { View } from "../../../../../../../packages/builder/src/builder/camera.ts";
import {
  atRest,
  desk,
  DEVICES,
  drill,
  hosted,
  house,
  inspector,
  MODULE,
  onCanvas,
  press,
  pv,
  settle,
  starts,
  testCore,
  undesk,
  undrawn,
} from "../builder.harness.ts";
import {
  handles,
  type Target,
  type Triple,
} from "../../../../../../../packages/builder/src/builder/handles/grips.ts";

type Scene = ReturnType<typeof house>["scene"];

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
  const draws = undrawn();
  const start = house();

  await render(Builder, {
    pv,
    ...hosted(testCore()),
    start,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Gebäude", "Baukörper 1");
  await settle(() => draws.mock.calls.length > 0);
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

/** The builder seen from above with the car place picked; the inspector's undo button. */
async function placePicked() {
  const draws = undrawn();
  const start = parked();

  localStorage.setItem("sunreye.builder.view", JSON.stringify(ABOVE));

  await render(Builder, {
    pv,
    ...hosted(testCore()),
    start,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Geräte", "Stellplatz 1");
  await settle(() => draws.mock.calls.length > 0);

  return {
    scene: start.scene,
    undo: inspector().getByRole("button", { name: "Rückgängig" }),
    draws,
  };
}

test("dragging a car place moves it in one undo step; its ring shows after Drehen and turns it", async () => {
  const { scene, undo, draws } = await placePicked();

  await mouseDrag(scene, [-3.75, 0, 3.5], [-3.75, 0, 5.5]);

  const z = inspector().getByRole("button", { name: starts("Position z (m)") });

  await expect.element(z.getByText(/^[23](,\d)?$/u)).toBeVisible();

  await undo.click();

  await expect.element(z.getByText(/^1$/u)).toBeVisible();
  await expect.element(undo).toBeDisabled();

  const place: Target = { kind: "place", index: 0 };
  const ring = handles(scene, place).find(({ grip }) => grip === "turn");

  if (ring?.radius === undefined) throw new Error("no ring");

  const [cx, , cz] = ring.at;
  const rotation = inspector().getByRole("button", { name: starts("Drehung (°)") });
  const tools = page.getByRole("toolbar", { name: "Aktionen" });

  await tools.getByRole("button", { name: "Drehen" }).click();

  // The ring takes the pointer once it is drawn, on the test's frame.
  await settle(atRest(draws));
  await mouseDrag(scene, [cx + ring.radius, 0, cz], [cx, 0, cz + ring.radius]);

  const turned = rotation.getByText(/^90$/u);

  // A drag lands on the frame after it: the test's.
  await settle(() => turned.query() !== null);
  await expect.element(turned).toBeVisible();
  await expect.element(tools.getByRole("status")).toHaveTextContent("Drehung 90°");

  await tools.getByRole("button", { name: "Fertig" }).click();
  await expect.element(tools.getByRole("button", { name: "Drehen" })).toBeVisible();

  // The turn is the one step there is to undo.
  await undo.click();
  await expect.element(rotation.getByText(/^0$/u)).toBeVisible();
  await expect.element(undo).toBeDisabled();
});

/** The house with a chimney on its south face, 3 m across and 1.5 m up it. */
function chimneyed() {
  const start = house();
  const chimney = { block: 0, face: 1, across: 3, up: 1.5, width: 0.6, depth: 0.6, height: 1.2 };

  return { ...start, scene: { ...start.scene, chimneys: [chimney] } };
}

test("a tap picks a chimney in 3D; a drag slides it along its face, never off it", async () => {
  const draws = undrawn();
  const start = chimneyed();
  const laid = pv.modules(start.scene, {});
  const [top] = handles(start.scene, { kind: "chimney", index: 0 }, laid);

  if (top === undefined) throw new Error("no chimney handle");

  await render(Builder, {
    pv,
    ...hosted(testCore()),
    start,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await settle(() => draws.mock.calls.length > 0);

  const onPage = onCanvas(start.scene);
  const [x, y] = top.at;

  await press("mouse", [onPage(top.at)]);
  await expect.element(inspector().getByRole("heading", { name: "Schornstein 1" })).toBeVisible();

  const across = inspector().getByRole("button", { name: starts("Mitte von links (m)") });

  await press("mouse", [
    onPage(top.at),
    onPage([x + 1, y, top.at[2]]),
    onPage([x + 2, y, top.at[2]]),
  ]);
  await expect.element(across.getByText(/^5$/u)).toBeVisible();

  // Far past the face's east end: it stops with its side on the verge, 10 m across.
  const moved = [x + 2, y, top.at[2]] as const;

  await press("mouse", [
    onPage(moved),
    onPage([x + 5, y, top.at[2]]),
    onPage([x + 9, y, top.at[2]]),
  ]);
  await expect.element(across.getByText(/^9,7$/u)).toBeVisible();
});

test("a press on a picked box drags it by its own surface, one undo step", async () => {
  const draws = undrawn();
  const start = house();

  const scene: Scene = {
    ...start.scene,
    obstacles: [{ kind: "box", x: -6, z: 10, width: 2, depth: 2, height: 2, rotation: 0 }],
  };

  localStorage.setItem("sunreye.builder.view", JSON.stringify(ABOVE));

  await render(Builder, {
    pv,
    ...hosted(testCore()),
    start: { ...start, scene },
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Umgebung", "Quader 1");
  await settle(() => draws.mock.calls.length > 0);

  // The box's top, 2 m up: the strike names the obstacle, and the drag moves it 2 m south.
  await mouseDrag(scene, [-5, 2, 11], [-5, 2, 13]);

  const z = inspector().getByRole("button", { name: starts("Position z (m)") });

  await expect.element(z.getByText(/^1[12](,\d)?$/u)).toBeVisible();

  await inspector().getByRole("button", { name: "Rückgängig" }).click();
  await expect.element(z.getByText(/^10$/u)).toBeVisible();
});
