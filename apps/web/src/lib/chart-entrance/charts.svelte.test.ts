// Every chart opts into the one chart entrance (ADR 21 "Chart entrance"): bars grow, lines, areas
// and canvases draw in from the left, a chart that grows live only fades.
import type { Component } from "svelte";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import DayChart from "../dashboard/DayChart.svelte";
import type { DayRow } from "../dashboard/today.ts";
import PriceChart from "../detail/PriceChart.svelte";
import ShareBar from "../detail/ShareBar.svelte";
import ShareChart from "../detail/ShareChart.svelte";
import LineBars from "../forecast/LineBars.svelte";
import SocLine from "../detail/SocLine.svelte";
import TrendChart from "../history/TrendChart.svelte";
import LiveArea from "../live-graph/LiveArea.svelte";
import type { Band } from "../range/bands.ts";
import HourBars from "../weather/HourBars.svelte";
import HourLines from "../weather/HourLines.svelte";
import type { Hour } from "../weather/hourly.ts";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 5, 1);

const hour = (i: number): Hour => ({
  at: T0 + i * HOUR,
  sky: null,
  celsius: 10 + i,
  apparent: 9 + i,
  precipitation: i % 3,
  snowfall: 0,
  cloudCover: 50,
  clearSkyIndex: 0.5,
  wind: 3,
  gusts: 5,
  windDirection: 90,
  humidity: 60,
});

const band = (i: number): Band => ({
  key: `b${i}`,
  label: `${i}`,
  tick: true,
  title: `${i}`,
  state: "data",
  partial: false,
  up: [20 + i * 10],
  down: [30],
  drillable: false,
});

const dayRows = (n: number): DayRow[] =>
  Array.from({ length: n }, (_, i) => ({
    time: new Date(T0 + (i * HOUR) / 4),
    actual: i,
    forecast: i + 1,
  }));

/** A day of hourly spot prices, the night's below zero. */
const priceDay = {
  zone: "UTC",
  now: new Date(T0 + 12 * HOUR),
  start: new Date(T0),
  end: new Date(T0 + 24 * HOUR),
  prices: Array.from({ length: 24 }, (_, i) => ({
    target: new Date(T0 + i * HOUR).toISOString(),
    value: (i - 3) / 100,
  })),
};

/** How the chart's entrance builds it: what each of its animations starts from. */
function builds(): string[] {
  return document
    .getAnimations()
    .filter((a) => a instanceof CSSAnimation)
    .map((a) => {
      const from = (a.effect as KeyframeEffect).getKeyframes()[0]!;

      if (from["scale"] !== undefined) return "grow";

      return from["translate"] === undefined ? "fade" : "draw";
    });
}

const CHARTS: readonly {
  name: string;
  chart: Component<never>;
  props: object;
  build: "grow" | "draw" | "fade";
}[] = [
  {
    name: "a trend",
    chart: TrendChart as Component<never>,
    props: {
      rows: Array.from({ length: 5 }, (_, i) => ({
        x: new Date(T0 + i * 24 * HOUR),
        values: { soh: 90 + i },
      })),
      series: [{ key: "soh", label: "SoH", colour: "red", kind: "area" }],
      fmt: (v: number) => `${v}`,
      label: "Trend",
    },
    build: "draw",
  },
  {
    name: "a weather row's lines",
    chart: HourLines as Component<never>,
    props: {
      hours: Array.from({ length: 24 }, (_, i) => hour(i)),
      span: [T0, T0 + 24 * HOUR],
      lines: [{ of: "celsius", colour: "red" }],
      label: "Temperatur",
    },
    build: "draw",
  },
  {
    name: "the state of charge",
    chart: SocLine as Component<never>,
    props: { bands: [band(0), band(1), band(2)], mean: 40, label: "Heute" },
    build: "draw",
  },
  {
    name: "a composition bar",
    chart: ShareBar as Component<never>,
    props: {
      title: "Verbrauch",
      total: 10,
      parts: [
        { label: "PV", colour: "red", share: 60 },
        { label: "Netz", colour: "blue", share: 40 },
      ],
    },
    build: "draw",
  },
  {
    name: "the spot prices",
    chart: PriceChart as Component<never>,
    props: { day: priceDay },
    build: "grow",
  },
  {
    name: "autarky and self-consumption by band",
    chart: ShareChart as Component<never>,
    props: { bands: [band(0), band(1), band(2)], grain: "hour", selfUse: 50 },
    build: "grow",
  },
  {
    name: "a weather row's precipitation",
    chart: HourBars as Component<never>,
    props: { hours: Array.from({ length: 24 }, (_, i) => hour(i)), label: "Niederschlag" },
    build: "grow",
  },
  {
    name: "a forecast day's strings",
    chart: LineBars as Component<never>,
    props: {
      title: "Strings",
      lines: [
        { label: "Süd", colour: "red", kwh: 8 },
        { label: "West", colour: "blue", kwh: 5 },
      ],
      top: 8,
    },
    build: "grow",
  },
  {
    name: "the day chart, which grows live",
    chart: DayChart as Component<never>,
    props: {
      rows: dayRows(96),
      now: new Date(T0 + 12 * HOUR),
      hours: new Intl.DateTimeFormat("de", { hour: "2-digit", timeZone: "UTC" }),
    },
    build: "fade",
  },
  {
    name: "the live graph",
    chart: LiveArea as Component<never>,
    props: {
      points: Array.from({ length: 30 }, (_, i) => ({ t: T0 + i * 2000, v: 1000 + i * 10 })),
      accent: "red",
      still: false,
    },
    build: "fade",
  },
];

test.each(CHARTS)("$name builds up as it first shows ($build)", async ({ chart, props, build }) => {
  await render(chart, { props: props as never });

  await expect.poll(builds).not.toEqual([]);

  const shown = builds();

  if (build === "fade") expect(shown.every((b) => b === "fade")).toBe(true);
  else expect(shown).toContain(build);
});

test("a price below zero grows down from the zero line, one above it up", async () => {
  await render(PriceChart, { day: priceDay as never });

  const grower = (price: number) =>
    document.querySelector<HTMLElement>(`[data-price="${price}"] [data-grow]`)!;
  const originY = (el: Element) => getComputedStyle(el).transformOrigin.split(" ")[1];

  expect(originY(grower(-0.03))).toBe("0px");
  expect(originY(grower(0.05))).toBe(getComputedStyle(grower(0.05)).height);
});
