/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// A card's height glides when its content changes it (ADR 21 "One behaviour, one component").
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

/** The card's glides: script animations, not its own press transitions. */
const glides = (card: HTMLElement) =>
  card.getAnimations().filter((a) => !(a instanceof CSSAnimation || a instanceof CSSTransition));

/** A card over content `height` px tall, its first size told. */
async function shown(props: {
  height: number;
  interactive?: boolean;
  width?: number;
  words?: number;
  fill?: boolean;
}) {
  const screen = await render(Harness, props);
  const card = screen.getByTestId("card").element();

  if (!(card instanceof HTMLElement)) throw new TypeError("The card is no HTML element.");

  const below = screen.getByTestId("below").element();

  playFrame();

  return { screen, card, below: () => below.getBoundingClientRect().top };
}

/** Puts a held glide halfway. */
function halfway(glide: Animation | undefined): void {
  if (glide !== undefined)
    glide.currentTime = Number(glide.effect?.getComputedTiming().duration) / 2;
}

for (const interactive of [false, true])
  test(`content that grows glides the ${interactive ? "interactive" : "plain"} card's height, and what stands below moves with it`, async () => {
    const { screen, card, below } = await shown({ height: 40, interactive });
    const [height, top] = [card.offsetHeight, below()];

    await screen.rerender({ height: 120 });
    await settle(() => glides(card).length > 0);

    expect(card.offsetHeight).toBe(height);

    halfway(glides(card)[0]);

    expect(card.offsetHeight).toBeGreaterThan(height);
    expect(card.offsetHeight).toBeLessThan(height + 80);
    expect(below()).toBeGreaterThan(top);
    expect(below()).toBeLessThan(top + 80);

    await finish();

    expect(card.offsetHeight).toBe(height + 80);
    expect(below()).toBe(top + 80);
    expect(glides(card)).toEqual([]);
  });

test("content that shrinks glides the card's height down", async () => {
  const { screen, card } = await shown({ height: 120 });
  const height = card.offsetHeight;

  await screen.rerender({ height: 40 });
  await settle(() => glides(card).length > 0);

  expect(card.offsetHeight).toBe(height);

  halfway(glides(card)[0]);

  expect(card.offsetHeight).toBeLessThan(height);
  expect(card.offsetHeight).toBeGreaterThan(height - 80);

  await finish();

  expect(card.offsetHeight).toBe(height - 80);
});

test("a card that mounts takes its height at once", async () => {
  const { card } = await shown({ height: 120 });

  playFrame();

  expect(glides(card)).toEqual([]);
});

test("a width the window sets takes its height at once", async () => {
  const { screen, card } = await shown({ height: 40, width: 320, words: 40 });
  const height = card.offsetHeight;

  await screen.rerender({ height: 40, width: 200, words: 40 });
  await tick();
  playFrame();

  expect(card.offsetHeight).toBeGreaterThan(height);
  expect(glides(card)).toEqual([]);
});

test("on the still tier a card takes its height at once", async () => {
  document.documentElement.dataset["motion"] = "still";

  const { screen, card } = await shown({ height: 40 });
  const height = card.offsetHeight;

  await screen.rerender({ height: 120 });
  await tick();
  playFrame();

  expect(card.offsetHeight).toBe(height + 80);
  expect(glides(card)).toEqual([]);
});

test("a part that fills the card, resized by the glide, does not restart it", async () => {
  const { screen, card } = await shown({ height: 120, fill: true });

  await screen.rerender({ height: 40, fill: true });
  await settle(() => glides(card).length > 0);
  halfway(glides(card)[0]);

  const at = glides(card)[0]?.currentTime;

  playFrame();
  playFrame();

  expect(glides(card)).toHaveLength(1);
  expect(glides(card)[0]?.currentTime).toBe(at);
});

test("content that changes mid-glide glides on from the height drawn", async () => {
  const { screen, card } = await shown({ height: 40 });
  const height = card.offsetHeight;

  await screen.rerender({ height: 120 });
  await settle(() => glides(card).length > 0);
  halfway(glides(card)[0]);

  const drawn = card.offsetHeight;

  await screen.rerender({ height: 200 });
  await settle(() => glides(card)[0]?.currentTime === 0);

  expect(card.offsetHeight).toBe(drawn);

  await finish();

  expect(card.offsetHeight).toBe(height + 160);
});
