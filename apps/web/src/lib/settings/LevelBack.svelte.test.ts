// A settings level is the drill-in's push (ADR 21 "One behaviour, one component"): it slides in
// over the list, which shifts aside, and back slides it out again.
import { tick } from "svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect } from "../api/core.ts";
import { HAPTICS } from "../haptics.ts";
import { framesUntil, realTimers } from "../motion/clock.harness.ts";
import { FakeCore } from "./devices.harness.ts";
import Routed from "./routed.harness.svelte";

let vibrate: ReturnType<typeof vi.fn<() => boolean>>;

beforeEach(async () => {
  await page.viewport(390, 800);
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
  localStorage.setItem(HAPTICS, "on");
});

afterEach(() => {
  realTimers();
  localStorage.removeItem(HAPTICS);
  // The levels move the hash.
  history.replaceState(null, "", location.pathname + location.search);
});

/** The pushed layer holding `node`. */
const layerOf = (node: Element) => node.closest<HTMLElement>("[data-push]");

/** How far right of its place a layer is drawn, in % of its width. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own type.
const right = (layer: HTMLElement | null) =>
  Number(/translateX\(([-\d.]+)%\)/u.exec(layer?.style.transform ?? "")?.[1] ?? Number.NaN);

/** The device list and its Wechselrichter row, the frames on the fake clock. */
async function devices() {
  const screen = await render(Routed, { core: connect(new FakeCore()), group: "devices" });
  const row = screen.getByRole("button", { name: /^Wechselrichter/u });

  await expect.element(row).toBeVisible();
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });

  return { screen, list: layerOf(row.element()) };
}

test("a device's level slides in over the list, which shifts aside; landing plays soft", async () => {
  const { screen, list } = await devices();

  await screen.getByRole("button", { name: /^Wechselrichter/u }).click();

  const level = screen.getByRole("region", { name: "Wechselrichter" });

  await framesUntil(() => level.query() !== null && right(layerOf(level.element())) < 70);

  expect(right(list)).toBeLessThan(0);
  expect(vibrate).not.toHaveBeenCalled();

  await framesUntil(() => list?.isConnected !== true);

  expect(right(layerOf(level.element()))).toBe(0);
  expect(vibrate).toHaveBeenCalledOnce();
});

test.for([
  ["the level's back button", () => page.getByRole("button", { name: "Geräte" }).click()],
  [
    "browser back",
    async () => {
      history.back();
      await Promise.resolve();
    },
  ],
] as const)(
  "%s slides a device's level out to the right over the list it came from",
  async ([, back]) => {
    const { screen } = await devices();

    await screen.getByRole("button", { name: /^Wechselrichter/u }).click();

    const level = screen.getByRole("region", { name: "Wechselrichter" });

    await framesUntil(() => level.query() !== null && right(layerOf(level.element())) === 0);

    const node = layerOf(level.element());

    await back();
    await tick();
    await framesUntil(() => right(node) > 30);

    // The list is back under the level, which is on its way out.
    await expect.element(screen.getByRole("button", { name: "Gerät hinzufügen" })).toBeVisible();

    await framesUntil(() => node?.isConnected !== true);

    await expect.element(screen.getByRole("button", { name: "Gerät hinzufügen" })).toBeVisible();
  },
);

test("a swipe from the screen's edge on a device's level goes back to the list, not out of Devices", async () => {
  const { screen } = await devices();

  await screen.getByRole("button", { name: /^Wechselrichter/u }).click();

  const level = screen.getByRole("region", { name: "Wechselrichter" });

  await framesUntil(() => level.query() !== null && right(layerOf(level.element())) === 0);

  const box = document.querySelector("[data-drill=box]")!;
  const { left, top } = box.getBoundingClientRect();
  const at = (x: number) => ({ pointerId: 1, clientX: left + x, clientY: top + 80, bubbles: true });

  box.dispatchEvent(new PointerEvent("pointerdown", at(4)));

  for (let i = 1; i <= 8; i++) {
    vi.advanceTimersByTime(16);
    box.dispatchEvent(new PointerEvent("pointermove", at(4 + 32 * i)));
  }

  await tick();
  // The finger moves the device's level, not the Devices page under it.
  expect(document.querySelector<HTMLElement>("[data-drill=page]")?.style.transform).toMatch(
    /^translateX\(0%\)/u,
  );
  expect(right(layerOf(level.element()))).toBeGreaterThan(50);
  box.dispatchEvent(new PointerEvent("pointerup", at(260)));

  await framesUntil(() => level.query() === null);

  await expect.element(screen.getByRole("button", { name: "Gerät hinzufügen" })).toBeVisible();
  expect(document.querySelector("[data-drill=page]")).not.toBeNull();
});
