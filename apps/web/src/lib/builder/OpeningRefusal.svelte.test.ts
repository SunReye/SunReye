import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { pv } from "./builder.harness.ts";
import BuildingLevel from "./BuildingLevel.svelte";
import type { Opening, Scene } from "./pv.ts";

/** The value editor lands at once. */
beforeEach(async () => {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
});

afterEach(async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

const window: Opening = {
  kind: "window",
  block: 0,
  wall: "front",
  along: 2,
  width: 1.2,
  height: 1.4,
  sill: 0.9,
};

/** A 10 × 8 m block with two windows on its front wall, at 2 m and at 5 m. */
const scene: Scene = {
  north: 0,
  blocks: [{ x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "flat" } }],
  obstacles: [],
  openings: [window, { ...window, along: 5 }],
};

const ALONG = "Abstand vom linken Ende (m)";

/** Types `value` into a number row's value editor and applies it. */
async function enter(row: string, value: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${RegExp.escape(row)} `, "u") }).click();
  await page.getByRole("button", { name: /tippen zum Eingeben/u }).click();
  await userEvent.fill(page.getByRole("textbox", { name: `${row} eingeben` }), value);
  await userEvent.keyboard("{Enter}");
  await page.getByRole("button", { name: /^Übernehmen/u }).click();
}

test("a window moved onto another is refused with the reason, until a change fits", async () => {
  const onchange = vi.fn<(scene: Scene) => void>();

  const screen = await render(BuildingLevel, {
    kind: "opening",
    index: 0,
    scene,
    roofs: [],
    pv,
    onchange,
    onremove: () => null,
  });

  // 4 m + 1.2 m lies over the window at 5 m.
  await enter(ALONG, "4");

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Dort liegt schon eine andere Öffnung.");
  expect(onchange).not.toHaveBeenCalled();

  await enter(ALONG, "3");

  await expect.poll(() => onchange.mock.calls.length).toBe(1);
  expect(screen.getByRole("alert").query()).toBeNull();
});
