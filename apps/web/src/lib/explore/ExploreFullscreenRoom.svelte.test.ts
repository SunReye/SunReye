import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
// The screen is laid out by the SPA's utilities.
import "../../app.css";
import { reset, show } from "./explore.harness.ts";

afterEach(reset);

// Without the browser's fullscreen, as iPhone Safari: the screen fills the window itself.
beforeEach(() => {
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });
});

afterEach(() => {
  Reflect.deleteProperty(document, "fullscreenEnabled");
});

const px = (value: string) => Number(value.replace("px", ""));

/** Where the window ends for the chart: the screen's bottom, less its padding. */
function floor(): number {
  const screen = document.querySelector("main")!;

  return screen.getBoundingClientRect().bottom - px(getComputedStyle(screen).paddingBottom);
}

/** The lanes with their time labels. */
const lanes = () => document.querySelector("[data-scrub]")!.parentElement!;

const plot = () => document.querySelector("[data-scrub]")!;

/** How far the last lane drawn ends above its plot's end, in px; the fold has no lanes. */
function undrawn(): number {
  const last = [...document.querySelectorAll("[data-scrub] > [role=img]")].at(-1);

  return last ? Math.abs(bottom(plot()) - bottom(last)) : 0;
}

const bottom = (of: Element | null) => of?.getBoundingClientRect().bottom ?? Number.NaN;

test.for([
  { mode: "series", query: "s=1:pv.power", end: lanes },
  {
    mode: "overlay",
    query: "mode=overlay&s=1:pv.power&range=day&at=2026-11-10&vs=2026-11-03",
    end: lanes,
  },
  { mode: "fold", query: "mode=fold&s=1:pv.power", end: () => document.querySelector("figure") },
] as const)(
  "in fullscreen the $mode chart ends where the window does, standing and lying down",
  async ({ query, end }) => {
    await page.viewport(390, 844);

    const { screen } = await show(query);

    await screen.getByRole("button", { name: "Vollbild", exact: true }).click();
    await expect.element(screen.getByRole("button", { name: "Vollbild beenden" })).toBeVisible();

    await expect.poll(() => Math.abs(bottom(end()) - floor())).toBeLessThan(1);
    await expect.poll(undrawn).toBeLessThan(1);

    // The same screen turned, as a phone is: the chart has to shrink to the shorter window.
    await page.viewport(870, 400);

    await expect.poll(() => Math.abs(bottom(end()) - floor())).toBeLessThan(1);
    await expect.poll(undrawn).toBeLessThan(1);
    expect(floor()).toBeGreaterThan(380);
    expect(floor()).toBeLessThanOrEqual(400);

    const card = getComputedStyle(document.querySelector("main [data-slot=card]")!);

    expect(px(card.paddingTop) + px(card.paddingLeft) + px(card.paddingBottom)).toBe(0);
    expect(card.boxShadow).toBe("none");
  },
);

test("lanes at their least scroll in a short window instead of being cut", async () => {
  await page.viewport(870, 400);

  const { screen } = await show("s=1:pv.power,1:grid.voltage,5:battery.soc,4294967295:weather.ghi");

  await screen.getByRole("button", { name: "Vollbild", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "Vollbild beenden" })).toBeVisible();

  // Four lanes of 84 px.
  await expect.poll(() => plot().clientHeight).toBe(336);
  expect(plot().scrollHeight).toBe(336);

  // The labels lie under the window's end, and scroll into it.
  expect(bottom(lanes())).toBeGreaterThan(floor());

  lanes().scrollIntoView({ block: "end" });

  expect(bottom(lanes())).toBeLessThanOrEqual(floor() + 1);
});
