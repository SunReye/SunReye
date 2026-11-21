import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { MODULE, pv } from "../builder/builder.harness.ts";
import type { Scene } from "../builder/pv.ts";
import { chip, finish, frame, layout, scene, show } from "./live-scene.harness.ts";
import { frames, framesUntil, realTimers, settle, stepUntil } from "../motion/clock.harness.ts";
import { feed } from "./stream.harness.ts";
import LiveScene from "./LiveScene.svelte";

/**
 * The scene once its first frame is drawn, its frames and clock on the test's clock throughout,
 * so a tween runs out on frames, not on time.
 */
async function drawn() {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });

  let ready = false;

  const screen = await show(
    [],
    () => {},
    () => {
      ready = true;
    },
  );

  await settle(() => ready);

  return screen;
}

/** A chip showing `value`, the frames played until it does. */
async function shown(name: string, value: string) {
  const button = page.getByRole("button", { name: `${name}: Details` });

  await framesUntil(() => button.getByText(value, { exact: true }).query() !== null);

  return chip(name, value);
}

beforeEach(async () => {
  localStorage.removeItem("sunreye.dashboard.view");
  await page.viewport(1280, 900);
});

afterEach(async () => {
  realTimers();
  vi.restoreAllMocks();
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

/** Draws counted once ten frames pass without one: a tween has run out. */
async function settled(draws: () => number): Promise<number> {
  let still = false;

  await stepUntil(
    () => still,
    async () => {
      const before = draws();

      await frames(10);
      still = draws() === before;
    },
  );

  return draws();
}

test("a live tick and a camera move draw a short tween, then drawing stops (ADR 20)", async () => {
  // Each frame of the tween is drawn in software: a small canvas keeps them few milliseconds.
  await page.viewport(480, 360);

  // Each draw runs the studio's passes once.
  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const send = feed();

  const screen = await drawn();

  send(frame(600, -1200));
  await shown("Süd", "600");

  const first = await settled(() => draws.mock.calls.length);

  expect(first).toBeGreaterThan(0);

  send(frame(700, -1100));
  await shown("Süd", "700");

  const ticked = await settled(() => draws.mock.calls.length);

  expect(ticked).toBeGreaterThan(first);

  const canvas = screen.getByLabelText("3D-Szene des Hauses");

  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 100, y: 100 },
    targetPosition: { x: 250, y: 100 },
  });
  await frames(10);

  expect(draws.mock.calls.length).toBeGreaterThan(ticked);
});

test("a car appears at its place while connected, with its charge power and SOC", async () => {
  const tick = feed();

  const parked = {
    ...scene,
    carPlaces: [{ device: 2, x: 12, z: 0, width: 2.5, length: 5, rotation: 0 }],
  } satisfies Scene;

  const screen = await render(LiveScene, {
    pv,
    layout: { ...layout, scene: parked },
    scene: parked,
    moduleTypes: [MODULE],
    capabilities: undefined,
    onselect: () => {},
  });

  tick({ devices: { ...frame(600, 0).devices, "2": { "ev.connected": 0 } } });

  await chip("Süd", "600");
  expect(screen.getByRole("button", { name: "E-Auto: Details" }).elements()).toHaveLength(0);

  tick({
    devices: {
      ...frame(600, 0).devices,
      "2": { "ev.connected": 1, "ev.charge.power": 7360, "ev.vehicle.soc": 63 },
    },
  });

  await expect.element((await chip("E-Auto", "7,4")).getByText("63")).toBeVisible();
});

/** The figure's fade, once it reports ready. */
async function fadeOnReady(): Promise<string> {
  let ready = false;

  const screen = await show(
    [],
    () => {},
    () => {
      ready = true;
    },
  );

  const figure = screen.getByRole("figure", { name: "Live-Ansicht des Hauses" });

  // Hidden and inert until its first frame is drawn, chips included.
  expect(figure.element().closest("[inert]")).not.toBeNull();

  await settle(() => ready);
  await expect.element(figure).not.toHaveAttribute("inert");
  // The fade runs to its end.
  await finish();
  expect(getComputedStyle(figure.element()).opacity).toBe("1");

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

/** Each chip's box on the page, by name. */
function boxes(names: readonly string[]): Record<string, DOMRect> {
  return Object.fromEntries(
    names.map((name) => [
      name,
      page
        .getByRole("button", { name: `${name}: Details` })
        .element()
        .getBoundingClientRect(),
    ]),
  );
}

/** The chips' boxes once they rest: each is measured, then placed once more by its own size. */
async function atRest(names: readonly string[]): Promise<Record<string, DOMRect>> {
  let last = "";
  let still = false;

  await stepUntil(
    () => still,
    async () => {
      const before = last;

      await frames(1);
      last = JSON.stringify(boxes(names));
      still = last === before;
    },
  );

  return boxes(names);
}

test("on a phone the chips sit in rows around the house and keep their place", async () => {
  await page.viewport(390, 600);

  const send = feed();

  const screen = await drawn();

  send(frame(600, -1200));
  await shown("Süd", "600");

  const names = ["Süd", "Wechselrichter", "Netz", "Haus"];
  const figure = screen.getByRole("figure", { name: "Live-Ansicht des Hauses" }).element();
  const first = await atRest(names);
  const within = figure.getBoundingClientRect();

  // The string above the house, the inverter under it, grid and house in one row below that.
  expect(first["Süd"]!.bottom).toBeLessThan(first["Wechselrichter"]!.top);
  expect(first["Wechselrichter"]!.bottom).toBeLessThan(first["Netz"]!.top);
  expect(first["Netz"]!.top).toBe(first["Haus"]!.top);
  expect(first["Netz"]!.right).toBeLessThan(first["Haus"]!.left);

  for (const box of Object.values(first)) {
    expect(box.left).toBeGreaterThanOrEqual(within.left);
    expect(box.right).toBeLessThanOrEqual(within.right);
    expect(box.top).toBeGreaterThanOrEqual(within.top);
    expect(box.bottom).toBeLessThanOrEqual(within.bottom);
  }

  // A tick redraws the scene with the camera still: no chip moves.
  send(frame(700, -1100));
  await shown("Süd", "700");
  await frames(5);

  const second = boxes(names);

  for (const name of names) {
    expect(second[name]!.top).toBe(first[name]!.top);
    expect(Math.abs(second[name]!.left - first[name]!.left)).toBeLessThan(2);
  }
});
