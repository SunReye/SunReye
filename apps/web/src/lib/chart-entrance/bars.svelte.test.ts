// Bars grow from their baseline as they first show (ADR 21 "Chart entrance").
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import PriceChart from "../detail/PriceChart.svelte";
import ShareChart from "../detail/ShareChart.svelte";
import LineBars from "../forecast/LineBars.svelte";
import HourBars from "../weather/HourBars.svelte";
import { expectBuilds } from "./built.harness.ts";
import { bands, hours, priceDay } from "./charts.fixtures.ts";

/** Where the bar of an hour priced `price` grows from, down from its top, and its height. */
function origin(price: number) {
  const bar = document.querySelector(`[data-price="${price}"] [data-grow]`);
  const style = bar === null ? null : getComputedStyle(bar);

  return { y: style?.transformOrigin.split(" ")[1], height: style?.height };
}

test("the spot prices grow", async () => {
  await render(PriceChart, { day: priceDay });

  await expectBuilds("grow");
});

test("a price below zero grows down from the zero line, one above it up", async () => {
  await render(PriceChart, { day: priceDay });

  expect(origin(-0.03).y).toBe("0px");
  expect(origin(0.05).y).toBe(origin(0.05).height);
});

test("autarky and self-consumption by band grow", async () => {
  await render(ShareChart, { bands, grain: "hour", selfUse: 50 });

  await expectBuilds("grow");
});

test("a weather row's precipitation grows", async () => {
  await render(HourBars, { hours, label: "Niederschlag" });

  await expectBuilds("grow");
});

test("a forecast day's strings grow", async () => {
  await render(LineBars, {
    title: "Strings",
    lines: [
      { label: "Süd", colour: "red", kwh: 8 },
      { label: "West", colour: "blue", kwh: 5 },
    ],
    top: 8,
  });

  await expectBuilds("grow");
});
