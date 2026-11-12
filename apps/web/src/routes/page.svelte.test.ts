import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { motion } from "../lib/motion/tier.svelte.ts";
import "../app.css";
import Page from "./+page.svelte";
import { asked, restoreCore, serveCore, served } from "./home.harness.ts";

beforeEach(serveCore);

afterEach(restoreCore);

test("the home screen renders its main landmark", async () => {
  const screen = await render(Page);
  await expect.element(screen.getByRole("main")).toBeInTheDocument();
});

test("without a scene the dashboard shows the 2D flow and offers no toggle", async () => {
  const screen = await render(Page);

  await asked("/api/v1/layout");
  expect(screen.getByLabelText("3D-Szene des Hauses").query()).toBeNull();
  expect(screen.getByRole("radio", { name: "2D" }).query()).toBeNull();
});

test("with a scene the dashboard opens on it, and the toggle's 2D outlives a reload", async () => {
  served.scene = true;

  const first = await render(Page);

  await expect.element(first.getByLabelText("3D-Szene des Hauses")).toBeVisible();
  await first.getByRole("radio", { name: "2D" }).click();
  await expect.element(first.getByRole("radio", { name: "2D" })).toBeChecked();
  expect(first.getByLabelText("3D-Szene des Hauses").query()).toBeNull();
  await first.unmount();

  const again = await render(Page);

  await expect.element(again.getByRole("radio", { name: "2D" })).toBeChecked();
  expect(again.getByLabelText("3D-Szene des Hauses").query()).toBeNull();
});

test("the 3D scene fills the hero, leaving no empty area", async () => {
  served.scene = true;

  const screen = await render(Page);
  const scene = screen.getByLabelText("3D-Szene des Hauses");

  await expect.element(scene).toBeVisible();

  const hero = screen
    .getByRole("region", { name: "Anlage live" })
    .element()
    .getBoundingClientRect();

  const drawn = scene.element().getBoundingClientRect();

  expect(drawn.height).toBeCloseTo(hero.height, 0);
  expect(drawn.width).toBeCloseTo(hero.width, 0);
});

test("the low-power switch shows the 2D flow", async () => {
  served.scene = true;

  const screen = await render(Page);

  await expect.element(screen.getByLabelText("3D-Szene des Hauses")).toBeVisible();
  motion.lowPower = true;

  await expect.element(screen.getByLabelText("3D-Szene des Hauses")).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "2D" }).query()).toBeNull();
});

test("without WebGL2 a scene still leaves the 2D flow", async () => {
  served.scene = true;
  // No context at all: the dashboard asks only for WebGL2.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

  const screen = await render(Page);

  await asked("/api/v1/layout");
  expect(screen.getByLabelText("3D-Szene des Hauses").query()).toBeNull();
  expect(screen.getByRole("radio", { name: "2D" }).query()).toBeNull();
});
