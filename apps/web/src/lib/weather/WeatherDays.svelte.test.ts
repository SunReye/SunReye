/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
import { tick } from "svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp } from "vitest/browser";
import { finish, hold } from "../motion/animations.harness.ts";
import { motion } from "@sunreye/builder/motion/tier.svelte.ts";
import { DRY, show } from "./weather-detail.harness.ts";

beforeEach(hold);

afterEach(() => {
  vi.restoreAllMocks();
  motion.lowPower = false;
});

/** The days in the sheet now: two while one slides out for the next. */
const shownDays = () => [...document.querySelectorAll<HTMLElement>("[data-day]")];

/** A day's travels under way, once they have started; the last one draws it. */
const travels = (day: HTMLElement) =>
  day.getAnimations().filter((animation) => Number(animation.effect?.getTiming().duration) > 0);

/** Holds a day's travel at `part` of its way and gives the day's horizontal offset there. */
function held(day: HTMLElement, part: number): number {
  const animation = travels(day).at(-1)!;

  animation.pause();
  animation.currentTime = Number(animation.effect!.getTiming().duration) * part;

  return new DOMMatrix(getComputedStyle(day).transform).m41;
}

/** Holds every day halfway through its travel and gives their offsets, in document order. */
async function midway(): Promise<number[]> {
  // No frame passes: the travels start as the days are drawn.
  await tick();

  expect(shownDays()).toHaveLength(2);
  expect(shownDays().every((day) => travels(day).length > 0)).toBe(true);

  return shownDays().map((day) => held(day, 0.5));
}

/** Ends every travel: the arriving day is alone and at rest. */
async function landed(): Promise<void> {
  await finish(() => shownDays().length === 1);
}

test("a later day slides in from the right, an earlier one from the left", async () => {
  const { screen } = await show({ forecasts: DRY });

  await expect.element(screen.getByRole("tab", { name: "Heute" })).toBeVisible();
  // The first day stands at once.
  expect(shownDays()[0]?.getAnimations()).toHaveLength(0);

  await screen.getByRole("tab", { name: "Montag" }).click();

  const [leaving, arriving] = await midway();

  expect(leaving).toBeLessThan(0);
  expect(arriving).toBeGreaterThan(0);

  await landed();
  await screen.getByRole("tab", { name: "Sonntag" }).click();

  const [back, earlier] = await midway();

  expect(back).toBeGreaterThan(0);
  expect(earlier).toBeLessThan(0);

  await landed();
  await expect.element(screen.getByRole("tabpanel", { name: "Sonntag" })).toBeVisible();
});

test("a second switch mid-slide goes on from where the days are", async () => {
  const { screen } = await show({ forecasts: DRY });

  await screen.getByRole("tab", { name: "Sonntag" }).click();

  const [, caught] = await midway();

  await screen.getByRole("tab", { name: "Montag" }).click();

  // Sunday, half in from the right, turns to leave on the left: a second travel, over its first.
  const sunday = shownDays()[1]!;

  await tick();

  expect(travels(sunday)).toHaveLength(2);

  expect(caught).toBeGreaterThan(0);
  expect(held(sunday, 0)).toBeCloseTo(caught!, 0);
  expect(held(sunday, 1)).toBeLessThan(0);
});

test.for([
  [
    "low power",
    () => {
      motion.lowPower = true;

      return Promise.resolve();
    },
  ],
  [
    "reduced motion",
    () =>
      cdp().send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      }),
  ],
] as const)("with %s a day switch is instant", async ([, still]) => {
  await still();

  try {
    const { screen } = await show({ forecasts: DRY });

    await screen.getByRole("tab", { name: "Sonntag" }).click();
    await expect.element(screen.getByText("1,0 h")).toBeVisible();

    expect(shownDays()).toHaveLength(1);
    expect(shownDays()[0]?.getAnimations()).toHaveLength(0);
  } finally {
    await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  }
});
