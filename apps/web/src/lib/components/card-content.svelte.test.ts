/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// A card resizes first, then what is new in it comes in (ADR 21 "One behaviour, one component").
import { tick } from "svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { finish, hold } from "../motion/animations.harness.ts";
import { playFrame, settle } from "../motion/clock.harness.ts";
import Harness from "./card-glide.harness.svelte";

beforeEach(hold);

afterEach(() => {
  vi.restoreAllMocks();
  delete document.documentElement.dataset["motion"];
});

/** The card's own glides. */
const glides = (card: HTMLElement) => card.getAnimations();

/** A card over content `height` px tall or its placeholder, its first size told. */
async function shown(props: {
  height: number;
  loading?: boolean;
  travels?: boolean;
  builds?: boolean;
}) {
  const screen = await render(Harness, props);
  const card = screen.getByTestId("card").element();

  if (!(card instanceof HTMLElement)) throw new TypeError("The card is no HTML element.");

  playFrame();

  return { screen, card };
}

/** How far `el` is seen, from 0 to 1. */
const seen = (el: Element) => Number(getComputedStyle(el).opacity);

/** Puts every held animation of the card and its content `ms` on from its start. */
function on(card: HTMLElement, ms: number): void {
  for (const a of card.getAnimations({ subtree: true })) a.currentTime = ms;
}

/** The glide's length: the move token, in ms. */
const MOVE = 300;

test("the card resizes first, then what is new in it comes in: data in place of a placeholder, held back while the card grows", async () => {
  const { screen, card } = await shown({ height: 120, loading: true });
  const height = card.offsetHeight;

  await screen.rerender({ height: 120, loading: false });
  await settle(() => glides(card).length > 0);

  const content = screen.getByTestId("content").element();

  expect(seen(content)).toBe(0);

  // The card has grown: its content is still to come.
  on(card, MOVE);

  expect(card.offsetHeight).toBe(height + 80);
  expect(seen(content)).toBe(0);

  const fade = Number(content.getAnimations()[0]?.effect?.getComputedTiming().duration) - MOVE;

  expect(fade).toBeGreaterThan(0);
  on(card, MOVE + fade / 2);

  expect(seen(content)).toBeGreaterThan(0);
  expect(seen(content)).toBeLessThan(1);

  await finish();

  expect(seen(content)).toBe(1);
  expect(content.getAnimations()).toEqual([]);
});

test("a card that shrinks closes first, then what is new in it comes in", async () => {
  const { screen, card } = await shown({ height: 120 });
  const height = card.offsetHeight;

  await screen.rerender({ height: 120, loading: true });
  await settle(() => glides(card).length > 0);

  const placeholder = screen.getByTestId("placeholder").element();

  expect(screen.getByTestId("content").query()).toBeNull();
  expect(seen(placeholder)).toBe(0);

  on(card, MOVE);

  expect(card.offsetHeight).toBe(height - 80);
  expect(seen(placeholder)).toBe(0);

  await finish();

  expect(seen(placeholder)).toBe(1);
});

test("content that stays and only changes its height is seen all the way", async () => {
  const { screen, card } = await shown({ height: 40 });
  const content = screen.getByTestId("content").element();

  await screen.rerender({ height: 120 });
  await settle(() => glides(card).length > 0);

  expect(seen(content)).toBe(1);
  expect(content.getAnimations()).toEqual([]);
});

test("content that arrives on a way of its own, as a pane that slides in, is seen all the way", async () => {
  const { screen, card } = await shown({ height: 120, loading: true });

  await screen.rerender({ height: 120, loading: false, travels: true });
  await settle(() => glides(card).length > 0);

  const content = screen.getByTestId("content").element();

  expect(seen(content)).toBe(1);
  expect(content.getAnimations()).toEqual([]);
});

test("what is new in a card that keeps its height comes in at once", async () => {
  const { screen, card } = await shown({ height: 40, loading: true });

  await screen.rerender({ height: 40, loading: false });
  await tick();
  playFrame();

  expect(glides(card)).toEqual([]);
  expect(seen(screen.getByTestId("content").element())).toBe(1);
});

test("on the still tier what is new in a card comes in at once", async () => {
  document.documentElement.dataset["motion"] = "still";

  const { screen, card } = await shown({ height: 120, loading: true });

  await screen.rerender({ height: 120, loading: false });
  await tick();
  playFrame();

  const content = screen.getByTestId("content").element();

  expect(seen(content)).toBe(1);
  expect(card.getAnimations({ subtree: true })).toEqual([]);
});

test("what builds up as it first shows, as a chart's entrance, waits for the card: it plays as the content comes in, not unseen", async () => {
  const { screen, card } = await shown({ height: 120, loading: true });

  await screen.rerender({ height: 120, loading: false, builds: true });
  await settle(() => glides(card).length > 0);

  const content = screen.getByTestId("content").element();
  const entrance = () => content.getAnimations().find((a) => a instanceof CSSAnimation);

  expect(entrance()?.playState).toBe("paused");
  expect(entrance()?.currentTime).toBe(0);

  // The card has its height: the content comes in, and its entrance plays.
  for (const glide of glides(card)) glide.finish();

  await expect.poll(() => entrance()?.playState).toBe("running");
});
