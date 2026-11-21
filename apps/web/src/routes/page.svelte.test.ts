import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect } from "../lib/api/core.ts";
import { motion } from "../lib/motion/tier.svelte.ts";
import { coreContext } from "../lib/shell/core.ts";
import "../app.css";
import Page from "./+page.svelte";
import { asked, homeCore, restoreCore, serveCore, served } from "./home.harness.ts";
import { keepOffline } from "./route.harness.ts";
import { appears, settle } from "../lib/motion/clock.harness.ts";

keepOffline();

beforeEach(serveCore);

afterEach(restoreCore);

test("the home screen renders its main landmark", async () => {
  const screen = await render(Page, { context: homeCore() });
  await expect.element(screen.getByRole("main")).toBeInTheDocument();
});

test("while the entry is checked, the brand mark stands alone, then a quiet line says why", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  try {
    const held = connect({
      base: "http://core.test/",
      fetch: () => Promise.withResolvers<Response>().promise,
    });

    const screen = await render(Page, { context: coreContext(held) });

    await expect.element(screen.getByRole("img", { name: "SunReye" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Anlage live" }).query()).toBeNull();
    expect(screen.getByText("Verbinde mit SunReye …").query()).toBeNull();

    vi.advanceTimersByTime(299);
    await Promise.resolve();
    expect(screen.getByText("Verbinde mit SunReye …").query()).toBeNull();

    vi.advanceTimersByTime(1);
    await expect.element(screen.getByText("Verbinde mit SunReye …")).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});

test("without a scene the dashboard shows the 2D flow and offers no toggle", async () => {
  const screen = await render(Page, { context: homeCore() });

  await asked("/api/v1/layout");
  expect(screen.getByLabelText("3D-Szene des Hauses").query()).toBeNull();
  expect(screen.getByRole("radio", { name: "2D" }).query()).toBeNull();
});

test("with a scene the dashboard opens on it, and the toggle's 2D outlives a reload", async () => {
  served.scene = true;

  const first = await render(Page, { context: homeCore() });

  await appears(first.getByLabelText("3D-Szene des Hauses"));
  await first.getByRole("radio", { name: "2D" }).click();
  await expect.element(first.getByRole("radio", { name: "2D" })).toBeChecked();
  expect(first.getByLabelText("3D-Szene des Hauses").query()).toBeNull();
  await first.unmount();

  const again = await render(Page, { context: homeCore() });

  await expect.element(again.getByRole("radio", { name: "2D" })).toBeChecked();
  expect(again.getByLabelText("3D-Szene des Hauses").query()).toBeNull();
});

test("the 3D scene fills the hero, leaving no empty area", async () => {
  served.scene = true;

  const screen = await render(Page, { context: homeCore() });
  const scene = screen.getByLabelText("3D-Szene des Hauses");

  await appears(scene);

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

  const screen = await render(Page, { context: homeCore() });

  await appears(screen.getByLabelText("3D-Szene des Hauses"));
  motion.lowPower = true;

  await expect.element(screen.getByLabelText("3D-Szene des Hauses")).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "2D" }).query()).toBeNull();
});

test("without WebGL2 a scene still leaves the 2D flow", async () => {
  served.scene = true;
  // No context on the page: the scene's renderer finds none and the browser is remembered.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

  const screen = await render(Page, { context: homeCore() });

  await settle(() => localStorage.getItem("sunreye.webgl2") === "no");
  await expect.element(screen.getByRole("radio", { name: "2D" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("3D-Szene des Hauses").query()).toBeNull();
});
