// A chart builds up as it first shows (ADR 21 "Chart entrance").
import { tick } from "svelte";
import { afterEach, beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { finish, holdEntrances } from "../motion/animations.harness.ts";
import { built } from "./built.harness.ts";
import Harness from "./entrance.harness.svelte";

beforeEach(holdEntrances);

afterEach(() => {
  delete document.documentElement.dataset["motion"];
});

const plot = () => document.querySelector("[data-plot]");
const bars = () => [...document.querySelectorAll("[data-grow]")];

/** What builds the bars. */
const grows = () => built().filter((b) => bars().includes(b.target));

/** The animation that starts from a translate beginning with `at`. */
const starts = (at: string) => built().find((b) => String(b.from["translate"]).startsWith(at));

test("nothing builds before the first data", async () => {
  await render(Harness, { build: "grow", ready: false });
  await tick();

  expect(bars()).toHaveLength(3);
  expect(built()).toEqual([]);
});

test("bars grow from the baseline, each a little after the one before, fading in", async () => {
  await render(Harness, { build: "grow", ready: true });

  await expect.poll(grows).toHaveLength(3);

  for (const g of grows()) expect(g.from).toMatchObject({ scale: "1 0", opacity: "0" });

  const delays = bars().map((bar) => grows().find((g) => g.target === bar)?.delay ?? -1);

  expect(delays[0]).toBe(0);
  expect(delays[1]).toBeGreaterThan(delays[0] ?? 0);
  expect(delays[2]).toBeGreaterThan(delays[1] ?? 0);
});

test("lines draw in from the left, fading in, while the plot stays in place", async () => {
  await render(Harness, { build: "draw", ready: true });

  await expect.poll(() => built().length).toBeGreaterThan(0);

  const [sweep, back] = [starts("-100%"), starts("100%")];

  expect(sweep?.from).toMatchObject({ opacity: "0" });
  expect(back?.target.contains(plot())).toBe(true);
  expect(back !== undefined && sweep?.target.contains(back.target)).toBe(true);
  expect(grows()).toEqual([]);
});

test("a chart that grows live only fades", async () => {
  await render(Harness, { build: "fade", ready: true });

  await expect.poll(built).toHaveLength(1);
  expect(built().map((b) => b.build)).toEqual(["fade"]);
});

test("data arriving after the chart mounts builds it then", async () => {
  const screen = await render(Harness, { build: "grow", ready: false });

  await screen.rerender({ build: "grow", ready: true });

  await expect.poll(grows).toHaveLength(3);
});

test("a chart already shown does not build again: its next data arrives in place", async () => {
  const screen = await render(Harness, { build: "grow", ready: true });

  await expect.poll(() => built().length).toBeGreaterThan(0);
  await finish();
  await expect.poll(built).toEqual([]);

  await screen.rerender({ build: "grow", ready: true, count: 6 });
  await tick();

  expect(bars()).toHaveLength(6);
  expect(built()).toEqual([]);
});

test("on the still tier a chart is drawn at once", async () => {
  document.documentElement.dataset["motion"] = "still";
  await render(Harness, { build: "grow", ready: true });
  await tick();

  expect(bars()).toHaveLength(3);
  expect(built()).toEqual([]);
});
