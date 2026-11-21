import { createRawSnippet, tick } from "svelte";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { hold } from "../motion/animations.harness.ts";
import Level from "./Level.svelte";

afterEach(() => {
  vi.restoreAllMocks();
});

const children = createRawSnippet(() => ({ render: () => "<p>Seite</p>" }));

test("a level slides in on ADR 21's ease-in-out, cubic-bezier(0.65, 0, 0.35, 1)", async () => {
  hold();

  const screen = await render(Level, {
    back: "Geräte",
    title: "Speicher",
    onback: () => null,
    children,
  });

  const level = screen.getByRole("region", { name: "Speicher" }).element();

  // The travel itself, once it has started.
  const travels = () =>
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own type.
    level.getAnimations().filter((each) => Number(each.effect?.getTiming().duration) > 0);

  // No frame passes: the travel starts as the level is drawn.
  await tick();

  expect(travels()).toHaveLength(1);

  const slide = travels()[0]!;

  expect(slide.effect?.getTiming().duration).toBe(300);

  slide.pause();
  slide.currentTime = 75;

  // The curve is 0.0708 of the way after a quarter of the time; a plain cubic is at 0.0625.
  const left =
    new DOMMatrix(getComputedStyle(level).transform).m41 / level.getBoundingClientRect().width;

  expect(left).toBeCloseTo(1 - 0.0708, 2);
});
