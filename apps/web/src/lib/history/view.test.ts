import { expect, test } from "bun:test";
import { figureView, tabsOf, viewOf } from "./view.ts";

const p = (q: string) => new URLSearchParams(q);

test("the route names the figure, its tab and the baseline; production over time by default", () => {
  expect(viewOf(p(""), true)).toEqual({ metric: "energy", tab: "time", cmp: "prev", sid: null });
  expect(viewOf(p("metric=money&tab=payback&cmp=year"), true)).toEqual({
    metric: "money",
    tab: "payback",
    cmp: "year",
    sid: null,
  });
  expect(viewOf(p("metric=plant&sid=3"), true)).toMatchObject({ tab: "strings", sid: 3 });
});

test("a tab the figure lacks falls back to its first; no battery, no battery tab", () => {
  expect(viewOf(p("metric=autarky&tab=forecast"), true).tab).toBe("time");
  expect(viewOf(p("metric=plant&tab=battery"), false).tab).toBe("strings");
  expect(tabsOf("plant", false)).toEqual(["strings", "data"]);
  expect(tabsOf("energy", true)).toEqual(["time", "years", "pattern", "forecast"]);
});

test("a detail sheet's figure opens its own view", () => {
  expect(figureView("saved")).toEqual({ metric: "money", tab: null, sid: null });
  expect(figureView("autarky")).toEqual({ metric: "autarky", tab: null, sid: null });
  expect(figureView("forecast")).toEqual({ metric: null, tab: "forecast", sid: null });
  expect(figureView("battery")).toEqual({ metric: "plant", tab: "battery", sid: null });
  expect(figureView("string-4")).toEqual({ metric: "plant", tab: "strings", sid: "4" });
  expect(figureView("production")).toEqual({ metric: null, tab: null, sid: null });
});
