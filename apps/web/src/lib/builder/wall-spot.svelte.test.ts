import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import Builder from "./Builder.svelte";
import {
  desk,
  DEVICES,
  drill,
  house,
  inspector,
  MODULE,
  onCanvas,
  phone,
  press,
  pv,
  starts,
  testCore,
  undesk,
  type Pointer,
} from "./builder.harness.ts";

const SLOW = { timeout: 15_000 };

const bar = () => page.getByRole("toolbar", { name: "Aktionen" });
const add = () => bar().getByRole("button", { name: "Hinzufügen" });
const heading = (name: string) => inspector().getByRole("heading", { name });
const undo = () => page.getByRole("button", { name: "Rückgängig" }).first();

beforeEach(async () => {
  localStorage.removeItem("sunreye.builder.view");
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
  await page.viewport(1280, 900);
});

/** The template house with bare walls, drawn; a tap on its front wall `along` it and `up`. */
async function bare() {
  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const { scene, strings } = house();
  const start = { strings, scene: { ...scene, openings: [] } };

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });
  await expect.poll(() => draws.mock.calls.length, SLOW).toBeGreaterThan(0);

  return (pointer: Pointer, along: number, up: number) =>
    press(pointer, [onCanvas(start.scene)([along, up, 8])]);
}

test.each<Pointer>(["mouse", "touch"])(
  "a %s tap on a wall offers Hinzufügen there: the window goes in under the tap, picked, one undo step",
  async (pointer) => {
    const tapWall = await bare();

    await tapWall(pointer, 3, 1.6);
    await add().click();
    await page.getByRole("menuitem", { name: "Fenster", exact: true }).click();

    // Picked on its own level, its middle where the tap was: 3 m less half its 1.2 m.
    await expect.element(heading("Fenster 1")).toBeVisible();
    await expect
      .element(
        inspector()
          .getByRole("button", { name: starts("Abstand vom linken Ende (m)") })
          .getByText(/^2,4$/u),
      )
      .toBeVisible();

    await undo().click();
    await expect.element(heading("Fenster 1")).not.toBeInTheDocument();
    await expect.element(undo()).toBeDisabled();
  },
);

test("a tap on a picked house's wall picks the spot too, and what does not fit there is refused in words", async () => {
  const tapWall = await bare();

  await drill("Gebäude", "Baukörper 1");
  await expect.element(bar()).toBeVisible();
  await expect.element(add()).not.toBeInTheDocument();

  await tapWall("mouse", 3, 1.6);
  await add().click();
  await page.getByRole("menuitem", { name: "Fenster", exact: true }).click();
  await expect.element(heading("Fenster 1")).toBeVisible();

  // Beside the window: a garage door there would lie over it.
  await tapWall("mouse", 4.6, 0.5);
  await add().click();
  await page.getByRole("menuitem", { name: "Garagentor" }).click();

  await expect
    .element(bar().getByRole("alert").filter({ hasText: "Dort liegt schon eine andere Öffnung." }))
    .toBeVisible();
  await expect.element(heading("Baukörper 1")).toBeVisible();
});

test("a battery's marker is hung at the tapped place on the wall", async () => {
  const tapWall = await bare();

  await tapWall("mouse", 6, 1.2);
  await add().click();
  await page.getByRole("menuitem", { name: "Batterie" }).click();

  await expect.element(heading("Batterie 1")).toBeVisible();
  await expect
    .element(
      inspector()
        .getByRole("button", { name: starts("Abstand vom linken Ende (m)") })
        .getByText(/^6$/u),
    )
    .toBeVisible();
});

test("on a phone the toolbar stands by the tapped spot and adding leaves the sheet down", async () => {
  await phone();

  const tapWall = await bare();
  const sheet = page.getByRole("button", { name: "Szene bearbeiten" });

  await tapWall("touch", 3, 1.6);
  await expect.element(add()).toBeVisible();

  const [x, y] = onCanvas({ ...house().scene, openings: [] })([3, 1.6, 8]);
  const box = bar().element().getBoundingClientRect();

  // A finger's width off the spot, not out by the house's far corner.
  expect(Math.abs((box.left + box.right) / 2 - x)).toBeLessThan(box.width / 2 + 1);
  expect(Math.min(Math.abs(box.bottom - y), Math.abs(box.top - y))).toBeLessThan(60);

  await add().click();
  await page.getByRole("menuitem", { name: "Haustür" }).click();
  await expect.element(bar().getByRole("button", { name: "Duplizieren" })).toBeVisible();
  await expect.element(sheet).toHaveAttribute("aria-expanded", "false");
});
