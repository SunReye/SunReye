import { expect, test } from "bun:test";
import type { Day } from "../dashboard/day.ts";
import { facts, figure } from "./figures.ts";

const at = (time: string) => `2026-11-12T${time}:00Z`;

const DAY: Day = {
  zone: "UTC",
  now: new Date(at("12:10")),
  start: new Date(at("00:00")),
  end: new Date("2026-11-13T00:00:00Z"),
  today: {
    production: 31.2,
    consumption: 14.8,
    feedIn: 16.9,
    purchase: 0.6,
    autarky: 96,
    selfUse: 46,
    peaks: { production: { watts: 8600, at: new Date(at("12:00")) }, consumption: null },
  },
  rows: [],
  pv: { total: 49.7, remaining: 18.5 },
  prices: [
    { target: at("11:00"), value: 0.081 },
    { target: at("12:00"), value: 0.368 },
    { target: at("13:00"), value: 0.193 },
  ],
  weather: { celsius: 21, sky: "sunny" },
  money: { paid: 0.19, earned: 1.39, saved: 5.93 },
};

test("a day figure's sheet leads with today's energy and shows the plant's live power", () => {
  expect(figure("production")).toMatchObject({ today: "production", node: "pv", chart: "pv" });
  expect(figure("purchase")).toMatchObject({ today: "purchase", node: "grid" });
});

test("a node's sheet is that node's, signed figures diverging", () => {
  expect(figure("battery")).toMatchObject({ node: "battery", direction: "battery" });
  expect(figure("string-4")).toMatchObject({ node: "string-4", chart: null });
  expect(figure("ev-7")).toMatchObject({ node: "ev-7" });
  expect(figure("generator")).toMatchObject({ node: "generator", colour: "var(--e-house)" });
});

test("an unknown figure has no sheet", () => {
  expect(figure("nonsense")).toBeNull();
});

test("the price leads with the slot in force and states the day's spread in ct/kWh", () => {
  const price = facts("price", DAY);

  expect(price.lead).toMatchObject({ value: 36.8, unit: "ct/kWh" });
  expect(price.stats).toEqual([
    { label: "Min", value: 8.1, unit: "ct/kWh", digits: 1 },
    { label: "Max", value: 36.8, unit: "ct/kWh", digits: 1 },
    { label: "Ø", value: 21.4, unit: "ct/kWh", digits: 1 },
  ]);
});

test("the live spot price wins over the day's when it streams", () => {
  expect(facts("price", DAY, 0.2).lead).toMatchObject({ value: 20 });
});

test("the forecast leads with what is still to come", () => {
  const forecast = facts("forecast", DAY);

  expect(forecast.lead).toMatchObject({ value: 18.5, unit: "kWh" });
  expect(forecast.stats[0]).toMatchObject({ value: 49.7 });
});

test("money figures read in euros", () => {
  expect(facts("saved", DAY).lead).toMatchObject({ value: 5.93, unit: "€" });
  expect(facts("feedIn", DAY).stats[0]).toMatchObject({ value: 1.39, unit: "€" });
});

test("before the day is read every figure is unknown, not zero", () => {
  expect(facts("price").lead).toMatchObject({ value: null });
  expect(facts("autarky").lead).toMatchObject({ value: null });
});
