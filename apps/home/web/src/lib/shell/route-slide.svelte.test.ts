/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
import { createRawSnippet, tick } from "svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { finish, hold } from "../motion/animations.harness.ts";
import { motion } from "../../../../../../packages/builder/src/motion/tier.svelte.ts";
import Shell from "./Shell.svelte";
import "../../app.css";

/** SvelteKit's `goto`, which the root layout passes: no router runs here. */
const goto = vi.fn((_url: string) => Promise.resolve());

const children = createRawSnippet(() => ({ render: () => "<p>page</p>" }));

beforeEach(hold);

afterEach(() => {
  vi.restoreAllMocks();
  motion.lowPower = false;
});

/** The screens in the page now: two while one slides out for the next. */
function screens(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-screen]")];
}

/** A screen's horizontal offset as it is drawn now. */
function shift(screen: HTMLElement): number {
  return new DOMMatrix(getComputedStyle(screen).transform).m41;
}

/** A screen's travels under way, once they have started; the last one draws it. */
function travels(screen: HTMLElement): Animation[] {
  return screen
    .getAnimations()
    .filter((animation) => Number(animation.effect?.getTiming().duration) > 0);
}

/** Holds a screen's travel at `part` of its way and gives the screen's offset there. */
function held(screen: HTMLElement, part: number): number {
  const animation = travels(screen).at(-1)!;

  animation.pause();
  animation.currentTime = Number(animation.effect!.getTiming().duration) * part;

  return shift(screen);
}

/** Holds every screen halfway through its travel and gives their offsets, in document order. */
async function midway(): Promise<number[]> {
  // No frame passes: the travels start as the screens are drawn.
  await tick();

  expect(screens()).toHaveLength(2);
  expect(screens().every((each) => travels(each).length > 0)).toBe(true);

  return screens().map((each) => held(each, 0.5));
}

/** Ends every travel: the arriving screen is alone and at rest. */
async function landed(): Promise<void> {
  await finish(() => screens().length === 1);
}

function shell(current: string | null) {
  return render(Shell, { shell: "bar", current, admin: true, goto, children });
}

test("going to a later screen slides it in from the right and the old one out to the left", async () => {
  const screen = await shell("/");

  await screen.rerender({ current: "/history" });

  const [leaving, arriving] = await midway();

  expect(leaving).toBeLessThan(0);
  expect(arriving).toBeGreaterThan(0);

  await landed();

  expect(shift(screens()[0]!)).toBe(0);
});

test("going to an earlier screen slides it in from the left", async () => {
  const screen = await shell("/forecast");

  await screen.rerender({ current: "/history" });

  const [leaving, arriving] = await midway();

  expect(leaving).toBeGreaterThan(0);
  expect(arriving).toBeLessThan(0);
});

test("back slides the way back", async () => {
  const screen = await shell("/");

  await screen.rerender({ current: "/history" });
  await landed();
  await screen.rerender({ current: "/" });

  const [leaving, arriving] = await midway();

  expect(leaving).toBeGreaterThan(0);
  expect(arriving).toBeLessThan(0);
});

test("More's screens follow the bar's, in the sheet's order", async () => {
  const screen = await shell("/forecast");

  await screen.rerender({ current: "/tariff" });

  expect((await midway())[1]).toBeGreaterThan(0);

  await landed();
  // Controls is listed above Tariff.
  await screen.rerender({ current: "/controls" });

  expect((await midway())[1]).toBeLessThan(0);
});

test("a route outside the navigation fades in place", async () => {
  const screen = await shell("/");

  await screen.rerender({ current: "/elsewhere" });

  expect(await midway()).toEqual([0, 0]);
  expect(screens().map((each) => Number(getComputedStyle(each).opacity))).toEqual([
    expect.closeTo(0.2, 0.2),
    expect.closeTo(0.8, 0.2),
  ]);
});

test("a second change mid-slide goes on from where the screens are", async () => {
  const screen = await shell("/");

  await screen.rerender({ current: "/history" });

  const [, caught] = await midway();

  await screen.rerender({ current: "/forecast" });

  // History, half in from the right, turns to leave on the left: a second travel, over its first.
  const history = screens()[1]!;

  await tick();

  expect(travels(history)).toHaveLength(2);

  expect(caught).toBeGreaterThan(0);
  expect(held(history, 0)).toBeCloseTo(caught!, 0);
  expect(held(history, 0.5)).toBeLessThan(caught!);
  expect(held(history, 1)).toBeLessThan(0);

  expect(travels(screens()[2]!)).toHaveLength(1);
  expect(held(screens()[2]!, 0.5)).toBeGreaterThan(0);
});

test("the leaving screen keeps its place while the page scrolls to the next one's", async () => {
  await page.viewport(390, 844);

  const tall = createRawSnippet(() => ({
    render: () => `<main style="height: 3000px"><p>page</p></main>`,
  }));

  const screen = await render(Shell, {
    shell: "bar",
    current: "/",
    admin: false,
    goto,
    children: tall,
  });

  scrollTo(0, 600);

  const before = screens()[0]!.getBoundingClientRect().top;

  await screen.rerender({ current: "/history" });

  // The router, putting the next screen at its top. The browser tells of a scroll on its next
  // frame: told at once.
  scrollTo(0, 0);
  dispatchEvent(new Event("scroll"));

  expect(before).toBe(-600);
  expect(screens()[0]!.getBoundingClientRect().top).toBeCloseTo(before, 0);
});

test("with low power a route change is instant", async () => {
  motion.lowPower = true;

  const screen = await render(Shell, { shell: "bar", current: "/", admin: false, goto, children });

  await screen.rerender({ current: "/history" });

  expect(screens()).toHaveLength(1);
  expect(screens()[0]?.getAnimations()).toHaveLength(0);
});

test("with reduced motion a route change is instant", async () => {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });

  try {
    const screen = await shell("/");

    await screen.rerender({ current: "/history" });

    expect(screens()).toHaveLength(1);
    expect(screens()[0]?.getAnimations()).toHaveLength(0);
  } finally {
    await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  }
});
