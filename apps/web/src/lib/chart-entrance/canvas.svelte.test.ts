// A chart on one canvas draws in from the left as it first shows (ADR 21 "Chart entrance").
import { afterEach, beforeEach, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import HeatGrid from "../analytics/HeatGrid.svelte";
import { PLANT } from "../api/computed-devices.ts";
import { reset, show } from "../explore/explore.harness.ts";
import FoldChart from "../explore/FoldChart.svelte";
import { expectBuilds } from "./built.harness.ts";
import { HOUR, T0, week } from "./charts.fixtures.ts";
import { holdEntrances } from "../motion/animations.harness.ts";

// Entrances held at their start: a test reads one before it has played out.
beforeEach(holdEntrances);

afterEach(reset);

test("a fold's bars draw in", async () => {
  await render(FoldChart, {
    rows: week,
    period: "day",
    counter: false,
    unit: "W",
    from: T0,
    to: T0 + 7 * 24 * HOUR,
    zone: "UTC",
    whole: "Woche",
    label: "Falten",
    height: 300,
  });

  await expectBuilds("draw");
});

test("the heat grid draws in", async () => {
  await render(HeatGrid, {
    cols: Array.from({ length: 3 }, (_, i) => ({ label: `${i}`, tick: true, title: `${i}` })),
    cells: Array.from({ length: 3 }, () => Array.from({ length: 24 }, (_, h) => h)),
    colour: () => "red",
    describe: (v: number | null) => `${v}`,
    idle: "Muster",
    label: "Muster",
  });

  await expectBuilds("draw");
});

test("the explore chart's lanes draw in", async () => {
  await show(`s=${PLANT}:pv.power`);

  await expectBuilds("draw");
});
