// A chart that grows live only fades in, once, so a tick never redraws it (ADR 21 "Chart entrance").
import { tick } from "svelte";
import { beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import DayChart from "../dashboard/DayChart.svelte";
import LiveArea from "../live-graph/LiveArea.svelte";
import { built, expectBuilds } from "./built.harness.ts";
import { quarters, HOUR, T0 } from "./charts.fixtures.ts";
import { finish, holdEntrances } from "../motion/animations.harness.ts";

// Entrances held at their start: a test reads one before it has played out.
beforeEach(holdEntrances);

test("the day chart fades in", async () => {
  await render(DayChart, {
    rows: quarters,
    now: new Date(T0 + 12 * HOUR),
    hours: new Intl.DateTimeFormat("de", { hour: "2-digit", timeZone: "UTC" }),
    live: true,
  });

  await expectBuilds("fade");
});

/** The live graph's props after `n` samples, one every 2 s. */
const live = (n: number) => ({
  points: Array.from({ length: n }, (_, i) => ({ t: T0 + i * 2000, v: 1000 + i * 10 })),
  accent: "red",
  still: false,
});

test("the live graph fades in", async () => {
  await render(LiveArea, live(30));

  await expectBuilds("fade");
});

test("a tick never redraws the live graph", async () => {
  const screen = await render(LiveArea, live(30));

  await expectBuilds("fade");
  await finish();
  await expect.poll(built).toEqual([]);

  await screen.rerender(live(31));
  await tick();

  expect(built()).toEqual([]);
});
