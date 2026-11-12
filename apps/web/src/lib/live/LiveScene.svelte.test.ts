import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { MODULE, pv } from "../builder/builder.harness.ts";
import type { Scene } from "../builder/pv.ts";
import { chip, frame, layout, scene, show, ticking } from "./live-scene.harness.ts";
import LiveScene from "./LiveScene.svelte";

/** Lets the browser paint `count` frames; a loop would draw in each of them. */
async function frames(count: number): Promise<void> {
  if (count === 0) return;

  await new Promise<void>((painted) => {
    requestAnimationFrame(() => {
      painted();
    });
  });
  await frames(count - 1);
}

beforeEach(async () => {
  localStorage.removeItem("sunreye.dashboard.view");
  await page.viewport(1280, 900);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

/** Draws counted once ten frames pass without one: a tween has run out. */
async function settled(draws: () => number): Promise<number> {
  await expect
    .poll(
      async () => {
        const before = draws();

        await frames(10);

        return draws() - before;
      },
      { timeout: 10_000 },
    )
    .toBe(0);

  return draws();
}

test("a live tick and a camera move draw a short tween, then drawing stops (ADR 20)", async () => {
  // Each draw runs the studio's passes once.
  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const { core, tick } = ticking();
  const screen = await show(core);

  await tick(frame(600, -1200));
  await chip("Süd", "0,6");

  const first = await settled(() => draws.mock.calls.length);

  expect(first).toBeGreaterThan(0);

  await tick(frame(700, -1100));
  await chip("Süd", "0,7");

  const ticked = await settled(() => draws.mock.calls.length);

  expect(ticked).toBeGreaterThan(first);

  const canvas = screen.getByLabelText("3D-Szene des Hauses");

  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 100, y: 100 },
    targetPosition: { x: 250, y: 100 },
  });

  expect(draws.mock.calls.length).toBeGreaterThan(ticked);
});

test("a car appears at its place while connected, with its charge power and SOC", async () => {
  const { core, tick } = ticking();

  const parked = {
    ...scene,
    carPlaces: [{ device: 2, x: 12, z: 0, width: 2.5, length: 5, rotation: 0 }],
  } satisfies Scene;

  const screen = await render(LiveScene, {
    core,
    pv,
    layout: { ...layout, scene: parked },
    scene: parked,
    moduleTypes: [MODULE],
    capabilities: undefined,
    onselect: () => {},
  });

  await tick({ devices: { ...frame(600, 0).devices, "2": { "ev.connected": 0 } } });

  await chip("Süd", "0,6");
  expect(screen.getByRole("button", { name: "E-Auto: Details" }).elements()).toHaveLength(0);

  await tick({
    devices: { "2": { "ev.connected": 1, "ev.charge.power": 7360, "ev.vehicle.soc": 63 } },
  });

  await expect.element((await chip("E-Auto", "7,4")).getByText("63")).toBeVisible();
});

/** The figure's fade, once it reports ready. */
async function fadeOnReady(): Promise<string> {
  const ready = vi.fn<() => void>();
  const { core } = ticking();
  const screen = await show(core, [], () => {}, ready);
  const figure = screen.getByRole("figure", { name: "Live-Ansicht des Hauses" });

  // Hidden and inert until its first frame is drawn, chips included.
  expect(figure.element().closest("[inert]")).not.toBeNull();

  await expect.poll(() => ready.mock.calls.length, { timeout: 15_000 }).toBe(1);
  await expect.element(figure).not.toHaveAttribute("inert");
  await expect.poll(() => getComputedStyle(figure.element()).opacity).toBe("1");

  return getComputedStyle(figure.element()).transitionDuration;
}

test("the scene and its chips fade in once its first frame is drawn", async () => {
  expect(await fadeOnReady()).toBe("0.35s");
});

test("under reduced motion the scene shows without a fade", async () => {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });

  expect(await fadeOnReady()).toBe("0s");
});
