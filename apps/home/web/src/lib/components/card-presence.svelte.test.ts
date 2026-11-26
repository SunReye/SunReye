/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// A card that appears or leaves opens or closes its height (ADR 21 "One behaviour, one component").
import { tick } from "svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { finish, hold } from "../motion/animations.harness.ts";
import { playFrame, settle } from "../motion/clock.harness.ts";
import Harness from "./card-presence.harness.svelte";

beforeEach(hold);

afterEach(() => {
  vi.restoreAllMocks();
  delete document.documentElement.dataset["motion"];
});

/** The column's gap, in px. */
const GAP = 16;

/** The animations that take time: a card's way in or out, held at its start. */
const moves = () =>
  document.getAnimations().filter((a) => Number(a.effect?.getComputedTiming().duration) > 0);

/** Puts every held move at `share` of its way. */
function at(share: number): void {
  for (const move of moves())
    move.currentTime = Number(move.effect?.getComputedTiming().duration) * share;
}

async function shown(props: { shown: boolean; screen?: boolean; grid?: boolean }) {
  const screen = await render(Harness, props);

  playFrame();

  const card = () => screen.getByTestId("card").query();

  return {
    screen,
    card,
    opacity: () => Number(getComputedStyle(card()!).opacity),
    below: () => screen.getByTestId("below").element().getBoundingClientRect().top,
  };
}

/** The card's height: the harness's 120 px of content and the card's own spacing. */
async function cardHeight(): Promise<number> {
  const { screen, card } = await shown({ shown: true });
  const height = card()!.getBoundingClientRect().height;

  await screen.unmount();

  return height;
}

test("a card that appears opens its height and fades in, and what stands below glides down", async () => {
  const height = await cardHeight();
  const { screen, opacity, below } = await shown({ shown: false });
  const top = below();

  await screen.rerender({ shown: true });
  await settle(() => moves().length > 0);

  expect(below()).toBe(top);
  expect(opacity()).toBe(0);

  at(0.5);

  expect(below()).toBeGreaterThan(top);
  expect(below()).toBeLessThan(top + height + GAP);
  expect(opacity()).toBeGreaterThan(0);
  expect(opacity()).toBeLessThan(1);

  await finish();

  expect(below()).toBe(top + height + GAP);
  expect(opacity()).toBe(1);
  expect(moves()).toEqual([]);
});

test("a card that leaves closes its height and fades out, and what stands below glides up", async () => {
  const height = await cardHeight();
  const { screen, card, opacity, below } = await shown({ shown: true });
  const top = below();

  await screen.rerender({ shown: false });
  await settle(() => moves().length > 0);

  expect(below()).toBe(top);
  expect(opacity()).toBe(1);

  at(0.5);

  expect(below()).toBeLessThan(top);
  expect(below()).toBeGreaterThan(top - height - GAP);
  expect(opacity()).toBeLessThan(1);

  // Closed, and still there: taking it away moves nothing.
  at(1);

  expect(card()).not.toBeNull();
  expect(below()).toBe(top - height - GAP);

  await finish();

  expect(card()).toBeNull();
  expect(below()).toBe(top - height - GAP);
});

test("a card that comes back while it leaves opens again from where it stands", async () => {
  const height = await cardHeight();
  const { screen, below } = await shown({ shown: true });
  const top = below();

  await screen.rerender({ shown: false });
  await settle(() => moves().length > 0);
  at(0.5);

  const [leaving] = moves();
  const drawn = below();

  await screen.rerender({ shown: true });
  await settle(() => moves().length > 0 && !moves().includes(leaving!));

  expect(Math.abs(below() - drawn)).toBeLessThan(1);

  await finish();

  expect(below()).toBe(top);
  expect(below()).toBeGreaterThan(drawn);
  expect(height).toBeGreaterThan(0);
});

test("a card there on a screen's first render stands at once", async () => {
  const { card } = await shown({ shown: true });

  await tick();
  playFrame();

  expect(card()).not.toBeNull();
  expect(moves()).toEqual([]);
});

test("a card that comes and goes with its screen, as a route's change takes it, does so at once", async () => {
  const { screen, card } = await shown({ shown: true, screen: false });

  await screen.rerender({ shown: true, screen: true });
  await tick();
  playFrame();

  expect(card()).not.toBeNull();
  expect(moves()).toEqual([]);

  await screen.rerender({ shown: true, screen: false });
  await tick();

  expect(card()).toBeNull();
});

test("a card whose data is there as its screen is first drawn, a moment after its first render, stands at once", async () => {
  const { screen, card } = await shown({ shown: false, screen: false });

  // No frame between the screen and its card: a read answered from memory.
  await screen.rerender({ shown: false, screen: true });
  await screen.rerender({ shown: true, screen: true });
  await tick();

  expect(card()).not.toBeNull();
  expect(moves()).toEqual([]);

  // Once drawn, the screen's cards come and go on their way.
  playFrame();
  await screen.rerender({ shown: false, screen: true });
  await settle(() => moves().length > 0);
  await finish();

  expect(card()).toBeNull();
});

test("in a grid, where a closed card's gap cannot close and columns reflow, a card appears and leaves at once", async () => {
  const { screen, card } = await shown({ shown: false, grid: true });

  await screen.rerender({ shown: true, grid: true });
  await expect.poll(card).not.toBeNull();

  expect(moves()).toEqual([]);

  await screen.rerender({ shown: false, grid: true });
  await expect.poll(card).toBeNull();
});

test("on the still tier a card appears and leaves at once", async () => {
  document.documentElement.dataset["motion"] = "still";

  const height = await cardHeight();
  const { screen, card, below } = await shown({ shown: false });
  const top = below();

  await screen.rerender({ shown: true });
  await expect.poll(card).not.toBeNull();

  expect(below()).toBe(top + height + GAP);
  expect(moves()).toEqual([]);

  await screen.rerender({ shown: false });
  await expect.poll(card).toBeNull();

  expect(below()).toBe(top);
  expect(moves()).toEqual([]);
});
