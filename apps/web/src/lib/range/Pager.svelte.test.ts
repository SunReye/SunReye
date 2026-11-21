/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
import { tick } from "svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { finish, hold } from "../motion/animations.harness.ts";
import { framesUntil, playFrame, realTimers } from "../motion/clock.harness.ts";
import Harness from "./pager.harness.svelte";

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  realTimers();
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

function card(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-testid=card]")!;
}

/** The track's offset in px; 0 at rest. */
function offset(): number {
  const transform = card().querySelector<HTMLElement>(".track")?.style.transform ?? "";

  return transform === "" ? 0 : Number(/translateX\(([-\d.]+)px\)/u.exec(transform)?.[1]);
}

/** A finger drags the card by `dx` px in `steps` moves `ms` apart. */
async function drag(dx: number, steps: number, ms: number, release = true): Promise<void> {
  const { left, top } = card().getBoundingClientRect();

  const at = (x: number) => ({
    pointerId: 1,
    pointerType: "touch",
    clientX: left + 200 + x,
    clientY: top + 40,
    bubbles: true,
  });

  card().dispatchEvent(new PointerEvent("pointerdown", at(0)));

  for (let i = 1; i <= steps; i++) {
    vi.advanceTimersByTime(ms);
    card().dispatchEvent(new PointerEvent("pointermove", at((dx * i) / steps)));
  }

  if (release) card().dispatchEvent(new PointerEvent("pointerup", at(dx)));

  await tick();
}

test("a drag draws the neighbour beside the page and follows the finger", async () => {
  const screen = await render(Harness, { steps: [] });

  await drag(-120, 6, 16, false);

  await expect.element(screen.getByText("Seite 2")).toBeInTheDocument();
  expect(offset()).toBeLessThan(0);
});

test("a drag past the threshold pages to the neighbour", async () => {
  const steps: (-1 | 1)[] = [];
  const screen = await render(Harness, { steps });

  await drag(-220, 8, 16);

  await framesUntil(() => steps.length === 1);
  expect(steps).toEqual([1]);
  await framesUntil(() => offset() === 0);
  await expect.element(screen.getByText("Seite 2")).toBeVisible();
  expect(screen.getByText("Seite 1").query()).toBeNull();
});

test("a drag back to the earlier page steps back", async () => {
  const steps: (-1 | 1)[] = [];

  await render(Harness, { steps });
  await drag(220, 8, 16);

  await framesUntil(() => steps.length === 1);
  expect(steps).toEqual([-1]);
});

test("a short drag springs back without paging", async () => {
  const steps: (-1 | 1)[] = [];
  const screen = await render(Harness, { steps });

  await drag(-40, 8, 30);

  await framesUntil(() => offset() === 0);
  expect(steps).toEqual([]);
  await expect.element(screen.getByText("Seite 1")).toBeVisible();
});

test("still motion steps on a swipe without moving the pages", async () => {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  const steps: (-1 | 1)[] = [];
  const screen = await render(Harness, { steps });

  await drag(-120, 4, 16, false);
  expect(offset()).toBe(0);
  card().dispatchEvent(
    new PointerEvent("pointerup", {
      pointerId: 1,
      clientX: card().getBoundingClientRect().left + 80,
      clientY: card().getBoundingClientRect().top + 40,
      bubbles: true,
    }),
  );

  await framesUntil(() => steps.length === 1);
  await expect.element(screen.getByText("Seite 2")).toBeVisible();
});

/** The pane that shows `page`, if there is one. */
const paneOf = (page: number) =>
  [...card().querySelectorAll<HTMLElement>(".pane")].find((p) =>
    p.textContent.includes(`Seite ${page}`),
  );

/** How far the pane that shows `page` is seen, and what holds it back. */
function pane(page: number) {
  const el = paneOf(page)!;

  return { seen: Number(getComputedStyle(el).opacity), held: el.getAnimations() };
}

/** The card's own glide, held at its start. */
const gliding = () => card().getAnimations().length > 0;

test("a pane that slides in to another height is seen all the way: only content swapped in place holds back", async () => {
  hold();

  const screen = await render(Harness, { steps: [] });

  playFrame();
  await screen.getByRole("button", { name: "Später" }).click();
  await framesUntil(gliding);

  expect(pane(2).seen).toBe(1);
  expect(pane(2).held).toEqual([]);

  await finish();
  await framesUntil(() => offset() === 0 && paneOf(1) === undefined);
  await screen.getByRole("button", { name: "Reiter" }).click();
  await framesUntil(gliding);

  // Swapped in place: unseen until the card has its height.
  expect(pane(3).seen).toBe(0);

  await finish();

  expect(pane(3).seen).toBe(1);
});

test("the neighbour a finger drags in stays seen as the card takes its height", async () => {
  hold();

  const steps: (-1 | 1)[] = [];

  await render(Harness, { steps });

  playFrame();
  await drag(-220, 8, 16);
  await framesUntil(() => steps.length === 1 && gliding());

  expect(pane(2).seen).toBe(1);
  expect(pane(2).held).toEqual([]);
});
