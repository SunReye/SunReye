// Lines and areas draw in from the left as they first show (ADR 21 "Chart entrance").
import { test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import ShareBar from "../detail/ShareBar.svelte";
import SocLine from "../detail/SocLine.svelte";
import TrendChart from "../history/TrendChart.svelte";
import HourLines from "../weather/HourLines.svelte";
import { expectBuilds } from "./built.harness.ts";
import { bands, HOUR, hours, T0 } from "./charts.fixtures.ts";

test("a trend draws in", async () => {
  await render(TrendChart, {
    rows: Array.from({ length: 5 }, (_, i) => ({
      x: new Date(T0 + i * 24 * HOUR),
      values: { soh: 90 + i },
    })),
    series: [{ key: "soh", label: "SoH", colour: "red", kind: "area" }],
    fmt: (v: number) => `${v}`,
    label: "Trend",
  });

  await expectBuilds("draw");
});

test("a weather row's lines draw in", async () => {
  await render(HourLines, {
    hours,
    span: [T0, T0 + 24 * HOUR],
    lines: [{ of: "celsius", colour: "red" }],
    label: "Temperatur",
  });

  await expectBuilds("draw");
});

test("the state of charge draws in", async () => {
  await render(SocLine, { bands, mean: 40, label: "Heute" });

  await expectBuilds("draw");
});

test("a composition bar draws in", async () => {
  await render(ShareBar, {
    title: "Verbrauch",
    total: 10,
    parts: [
      { label: "PV", colour: "red", share: 60 },
      { label: "Netz", colour: "blue", share: 40 },
    ],
  });

  await expectBuilds("draw");
});
