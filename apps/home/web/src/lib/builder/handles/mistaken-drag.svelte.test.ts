import "../../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Builder from "../../../../../../../packages/builder/src/builder/Builder.svelte";
import {
  desk,
  DEVICES,
  drill,
  hosted,
  house,
  inspector,
  MODULE,
  onCanvas,
  phone,
  type Pointer,
  press,
  pv,
  settle,
  starts,
  testCore,
  undesk,
} from "../builder.harness.ts";
import { handles } from "../../../../../../../packages/builder/src/builder/handles/grips.ts";
import { offered } from "../../../../../../../packages/builder/src/builder/handles/offered.ts";

const VIEW = "sunreye.builder.view";

beforeEach(async () => {
  localStorage.removeItem(VIEW);
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
});

/** The builder with the template house's block picked, as a tap on it leaves it. */
async function picked() {
  const draws = vi.spyOn(EffectComposer.prototype, "render");
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

  return start.scene;
}

/** An orbit's worth of travel from a page point: 80 px to the right, in steps. */
const swipe = ([x, y]: readonly [number, number]) =>
  [0, 20, 40, 60, 80].map((dx): [number, number] => [x + dx, y]);

/** Nothing was dragged: the block stands as it stood, with nothing to undo, and the view turned. */
async function orbited(): Promise<void> {
  await settle(() => localStorage.getItem(VIEW) !== null);
  await expect
    .element(
      inspector()
        .getByRole("button", { name: starts("Drehung (°)") })
        .getByText(/^0$/u),
    )
    .toBeVisible();
  await expect.element(inspector().getByRole("button", { name: "Rückgängig" })).toBeDisabled();
}

test.each<Pointer>(["mouse", "touch"])(
  "a %s drag from the ground beside a picked house orbits: the house is not turned",
  async (pointer) => {
    const scene = await picked();
    const ring = handles(scene, { kind: "block", index: 0 }).find(({ grip }) => grip === "turn");

    if (ring?.radius === undefined) throw new Error("no ring");

    // Where the ring lay on the ground, east of the house.
    await press(pointer, swipe(onCanvas(scene)([ring.at[0] + ring.radius, 0, ring.at[2]])));
    await orbited();
  },
);

test.each<Pointer>(["mouse", "touch"])(
  "a %s drag that starts on a picked house orbits: the house is not moved",
  async (pointer) => {
    const scene = await picked();

    // Its front wall, a metre and a half up.
    await press(pointer, swipe(onCanvas(scene)([2, 1.5, 8])));
    await orbited();
  },
);

test.each<Pointer>(["mouse", "touch"])(
  "a %s drag of the knob before a picked house's front wall moves the house, one undo step",
  async (pointer) => {
    const scene = await picked();

    const knob = offered(scene, { kind: "block", index: 0 }, pv.modules(scene, {}), false).find(
      ({ grip }) => grip === "carry",
    );

    if (knob === undefined) throw new Error("no knob");

    const [x, y, z] = knob.at;
    const onPage = onCanvas(scene);

    // Two metres east along the ground.
    await press(pointer, [onPage(knob.at), onPage([x + 1, y, z]), onPage([x + 2, y, z])]);

    const east = inspector().getByRole("button", { name: starts("Position x (m)") });
    const undo = inspector().getByRole("button", { name: "Rückgängig" });

    await expect.element(east.getByText(/^[1-4](,\d)?$/u)).toBeVisible();
    await undo.click();
    await expect.element(east.getByText(/^0$/u)).toBeVisible();
    await expect.element(undo).toBeDisabled();
  },
);

test.each<Pointer>(["mouse", "touch"])(
  "after Drehen a %s drag sideways anywhere turns the house about its centre, one undo step",
  async (pointer) => {
    await picked();
    const tools = page.getByRole("toolbar", { name: "Aktionen" });
    const rotation = inspector().getByRole("button", { name: starts("Drehung (°)") });
    const undo = inspector().getByRole("button", { name: "Rückgängig" });

    await tools.getByRole("button", { name: "Drehen" }).click();
    const canvas = page.getByLabelText("3D-Szene des Hauses").element().getBoundingClientRect();

    // Off the ring, low on the canvas, before the house's middle: what is under the pointer
    // follows it.
    await press(pointer, swipe([canvas.left + 120, canvas.bottom - 160]));

    // 80 px to the right is 40° against the clock.
    await expect.element(rotation.getByText(/^320$/u)).toBeVisible();
    await expect.element(tools.getByRole("status").getByText("Drehung 320°")).toBeVisible();

    await tools.getByRole("button", { name: "Fertig" }).click();
    await undo.click();
    await expect.element(rotation.getByText(/^0$/u)).toBeVisible();
    await expect.element(undo).toBeDisabled();
  },
);

test("while strings are wired a drag from the house orbits: a block has handles on its own level only", async () => {
  const scene = await picked();

  await drill("Gebäude", "Szene", "Strings");
  await press("mouse", swipe(onCanvas(scene)([2, 1.5, 8])));
  await settle(() => localStorage.getItem(VIEW) !== null);
  await expect.element(inspector().getByRole("button", { name: "Rückgängig" })).toBeDisabled();
});

test("on a phone a picked house's knob lies in the canvas, clear of the sheet and the status line", async () => {
  await phone();

  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const { scene } = house();

  await render(Builder, {
    pv,
    ...hosted(testCore()),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });
  await settle(() => draws.mock.calls.length > 0);

  const knob = offered(scene, { kind: "block", index: 0 }, pv.modules(scene, {}), false).find(
    ({ grip }) => grip === "carry",
  );

  if (knob === undefined) throw new Error("no knob");

  const [x, y] = onCanvas(scene)(knob.at);
  const canvas = page.getByLabelText("3D-Szene des Hauses").element().getBoundingClientRect();
  const status = page.getByRole("group", { name: "Jetzt in der Szene" }).element();

  expect(x).toBeGreaterThan(canvas.left + 22);
  expect(x).toBeLessThan(canvas.right - 22);
  expect(y).toBeGreaterThan(canvas.top + 22);
  expect(y).toBeLessThan(status.getBoundingClientRect().top - 22);
  await page.viewport(1280, 900);
});
