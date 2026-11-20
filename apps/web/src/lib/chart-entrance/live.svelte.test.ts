// A chart that grows live only fades in, once, so a tick never redraws it (ADR 21 "Chart entrance").
import { test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import DayChart from "../dashboard/DayChart.svelte";
import LiveArea from "../live-graph/LiveArea.svelte";
import { expectBuilds } from "./built.harness.ts";
import { dayRows, HOUR, T0 } from "./charts.fixtures.ts";

test("the day chart fades in", async () => {
  await render(DayChart, {
    rows: dayRows,
    now: new Date(T0 + 12 * HOUR),
    hours: new Intl.DateTimeFormat("de", { hour: "2-digit", timeZone: "UTC" }),
  });

  await expectBuilds("fade");
});

test("the live graph fades in", async () => {
  await render(LiveArea, {
    points: Array.from({ length: 30 }, (_, i) => ({ t: T0 + i * 2000, v: 1000 + i * 10 })),
    accent: "red",
    still: false,
  });

  await expectBuilds("fade");
});
