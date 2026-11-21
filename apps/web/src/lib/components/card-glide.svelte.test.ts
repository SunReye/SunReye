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
  label?: string;
  loading?: boolean;
  frame?: string;
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

test("a card that mounts takes its height at once, its content filled before it is drawn", async () => {
  const screen = await render(Harness, { height: 40 });

  await screen.rerender({ height: 120 });
  await tick();
  playFrame();

  const card = screen.getByTestId("card").element();

  expect(card.getAnimations()).toEqual([]);
});

test("content redrawn to a width the window sets takes its height at once", async () => {
  const { screen, card } = await shown({ height: 40, width: 320 });

  await screen.rerender({ height: 120, width: 200 });
  await tick();
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

test("a card whose own frame changes, as a screen's mode sets it, takes its height at once", async () => {
  const { screen, card } = await shown({ height: 40, words: 40 });
  const height = card.offsetHeight;

  await screen.rerender({ height: 40, words: 40, frame: "p-12" });
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

test("data in place of a placeholder glides, and a placeholder in place of data", async () => {
  const { screen, card } = await shown({ height: 120, loading: true });
  const height = card.offsetHeight;

  await screen.rerender({ height: 120, loading: false });
  await settle(() => glides(card).length > 0);

  expect(card.offsetHeight).toBe(height);

  await finish();

  expect(card.offsetHeight).toBe(height + 80);

  await screen.rerender({ height: 120, loading: true });
  await settle(() => glides(card).length > 0);

  expect(card.offsetHeight).toBe(height + 80);

  await finish();

  expect(card.offsetHeight).toBe(height);
});

test("a change mid-glide that leaves the height where it is going leaves the glide running", async () => {
  const { screen, card } = await shown({ height: 40, label: "1 kW" });

  await screen.rerender({ height: 120, label: "1 kW" });
  await settle(() => glides(card).length > 0);
  halfway(glides(card)[0]);

  // A glide begun anew waits a frame to start: one begun on every frame of a swipe never moves.
  const [glide] = glides(card);
  const at = glide?.currentTime;

  for (const label of ["2 kW", "3 kW", "4 kW"]) {
    // oxlint-disable-next-line no-await-in-loop -- one change a frame, as a swipe's slide makes.
    await screen.rerender({ height: 120, label });
    // oxlint-disable-next-line no-await-in-loop -- as above.
    await tick();
    playFrame();
  }

  expect(glides(card)).toEqual([glide]);
  expect(glide?.currentTime).toBe(at);
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

/** A frame of a held glide, in ms. */
const FRAME = 16;

/** Plays one frame of the card's held glides: the height it is then drawn at. */
function frame(card: HTMLElement): number {
  for (const glide of glides(card)) glide.currentTime = Number(glide.currentTime) + FRAME;

  return card.getBoundingClientRect().height;
}

/**
 * The card's height on each frame as its content takes each of `heights` in turn, `every` frames
 * apart, until it has landed on the last.
 */
async function drawnOver(heights: readonly [number, ...number[]], every: number) {
  const { screen, card } = await shown({ height: heights[0] });
  const drawn = [card.getBoundingClientRect().height];

  for (const height of heights.slice(1)) {
    // oxlint-disable-next-line no-await-in-loop -- one change after another, mid-glide.
    await screen.rerender({ height });
    // oxlint-disable-next-line no-await-in-loop -- as above.
    await settle(() => glides(card).length > 0);

    for (let i = 0; i < every; i++) drawn.push(frame(card));
  }

  // A glide lasts under 40 frames.
  for (let i = 0; i < 40; i++) drawn.push(frame(card));

  await screen.unmount();

  return drawn;
}

/** The change from each value to the next. */
const changes = (values: readonly number[]) => values.slice(1).map((v, i) => v - (values[i] ?? v));

/** The frames on which the card moved: until it landed. */
const moving = (drawn: readonly number[]) =>
  changes(drawn.slice(0, drawn.indexOf(drawn.at(-1)!) + 1));

/** The largest change of speed from one frame to the next, in px a frame. */
const jolt = (drawn: readonly number[]) =>
  Math.max(...changes(moving(drawn)).map((change) => Math.abs(change)));

test("content that changes again and again mid-glide keeps the card moving: it never stands, turns back or jolts", async () => {
  // A glide alone sets what smooth is: how fast its speed changes at most.
  const alone = jolt(await drawnOver([40, 120], 0));
  // Each change comes as the glide before it is at its fastest.
  const drawn = await drawnOver([40, 120, 200, 280], 9);
  const steps = moving(drawn);

  expect(drawn.at(-1)).toBe(drawn[0]! + 240);
  expect(Math.min(...steps)).toBeGreaterThan(0);
  // Two glides are under way at once at most: no more than both changing speed together.
  expect(jolt(drawn)).toBeLessThanOrEqual(2 * alone);
});
