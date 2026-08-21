import { afterAll, describe, expect, test } from "bun:test";
import { costRangeFor, customCostRange, resolveCostPreset } from "$lib/cost/ranges";
import { overwriteGetLocale, type Locale } from "$lib/paraglide/runtime";
import { browserTimeZone } from "$lib/time/browser-zone";
import { periodWindow, stepPeriod, type Grain } from "$lib/time/period";
import { chartCaption, scopeToggle } from "./chart-scope";

/**
 * The captions are read against the REAL clock, and the periods are built from
 * it. A fixed anchor would be a time bomb: `periodTitle` drops the year from a
 * day label only while that day is in the current year, so a hard-coded
 * "Aug 12, by hour" starts reading "Aug 12, 2026, by hour" next January.
 */
const NOW = new Date();
const OPTS = { timeZone: browserTimeZone() };

/** The range the navigator's tab produces, `back` presses from now. */
const tab = (grain: Grain, back = 0) => {
  const here = periodWindow(NOW, grain, OPTS);
  return costRangeFor(back === 0 ? here : stepPeriod(here, -back, OPTS), NOW);
};

/** The same month/year name `Intl` gives, derived independently of the module. */
const monthName = (d: Date) =>
  new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(d);

describe("chartCaption — a calendar period names itself", () => {
  test("captions the day tab with the day it is plotting", () => {
    expect(chartCaption(tab("day"), "detail")).toBe("Today, by hour");
  });

  test("a PAST day is not captioned 'Today'", () => {
    // The cheap wrong answer is a caption keyed on the grain alone. It reads
    // "Today, by hour" for every day the reader steps back to.
    const caption = chartCaption(tab("day", 1), "detail");
    expect(caption).not.toContain("Today");
    expect(caption).toMatch(/^\w+ \d{1,2}, by hour$/);
  });

  test("captions the week tab by the date the week starts on", () => {
    expect(chartCaption(tab("week"), "detail")).toMatch(/^Week of \w+ \d{1,2}, by day$/);
  });

  test("captions the month and year tabs from the calendar, not from an id", () => {
    expect(chartCaption(tab("month"), "detail")).toBe(`${monthName(NOW)}, by day`);
    expect(chartCaption(tab("year"), "detail")).toBe(`${NOW.getFullYear()}, by month`);
  });

  test("a past month carries ITS name, where the old preset caption said 'This month'", () => {
    const lastMonth = tab("month", 1);
    expect(chartCaption(lastMonth, "detail")).toBe(`${monthName(lastMonth.from)}, by day`);
    expect(chartCaption(lastMonth, "detail")).not.toBe(chartCaption(tab("month"), "detail"));
  });

  test("names the window the context chart zooms out to, per grain", () => {
    // The same words the range builders bake into the spec, localized — the
    // day and week context chart IS `thisMonthByDay`.
    expect(chartCaption(tab("day"), "context")).toBe("This month, by day");
    expect(chartCaption(tab("week"), "context")).toBe("This month, by day");
    expect(chartCaption(tab("month"), "context")).toBe("Last 12 months");
    expect(chartCaption(tab("year"), "context")).toBe("Last 24 months");
  });
});

describe("chartCaption — the ranges that are not calendar periods", () => {
  test("keeps the kept preset's own captions", () => {
    const week = resolveCostPreset("7d", NOW);
    expect(chartCaption(week, "detail")).toBe("Last 7 days, by day");
    expect(chartCaption(week, "context")).toBe("This month, by day");
  });

  test("keeps a custom span's captions", () => {
    const custom = customCostRange(new Date(2026, 6, 17), new Date(2026, 7, 2), NOW);
    expect(chartCaption(custom, "detail")).toBe("Custom range, by day");
    expect(chartCaption(custom, "context")).toBe("Last 12 months");
  });
});

describe("scopeToggle — one control, one grammar", () => {
  // The switcher this replaces offered "By day" beside "12 months": a BUCKET
  // name next to a SPAN name, two grammars in one segmented row, and no clue
  // which of them the reader is currently looking at. The toggle names the
  // window it takes you TO, so both of its states read as spans.
  const toLabel = (grain: Grain) => scopeToggle(tab(grain), "detail").label;
  const backLabel = (grain: Grain) => scopeToggle(tab(grain), "context").label;

  test("from the picked window it offers the wider one, by name", () => {
    expect(scopeToggle(tab("month"), "detail").next).toBe("context");
    expect(toLabel("day")).toBe("This month");
    expect(toLabel("week")).toBe("This month");
    expect(toLabel("month")).toBe("12 months");
    expect(toLabel("year")).toBe("24 months");
  });

  test("from the wider window it offers the picked one, by its own name", () => {
    // The navigator prints exactly these words above the chart, so the way back
    // is named after the period the reader chose rather than after a bucket.
    expect(scopeToggle(tab("month"), "context").next).toBe("detail");
    expect(backLabel("day")).toBe("Today");
    expect(backLabel("week")).toMatch(/^Week of \w+ \d{1,2}$/);
    expect(backLabel("month")).toBe(monthName(NOW));
    expect(backLabel("year")).toBe(String(NOW.getFullYear()));
  });

  test("no label is a bucket, in either direction, for any grain", () => {
    // The whole defect: "By day" is an answer to "how finely?", "12 months" to
    // "over what span?". A single control cannot ask both.
    for (const grain of ["day", "week", "month", "year"] as const) {
      expect(toLabel(grain)).not.toMatch(/^By /);
      expect(backLabel(grain)).not.toMatch(/^By /);
      expect(toLabel(grain)).not.toBe(backLabel(grain));
    }
  });

  test("a kept preset and a custom span name themselves too", () => {
    const week = resolveCostPreset("7d", NOW);
    expect(scopeToggle(week, "detail").label).toBe("This month");
    expect(scopeToggle(week, "context").label).toBe("Last 7 days");

    const custom = customCostRange(new Date(2026, 6, 17), new Date(2026, 7, 2), NOW);
    expect(scopeToggle(custom, "detail").label).toBe("12 months");
    // The dates the reader picked, not the word "Custom" — the label the range
    // already carries.
    expect(scopeToggle(custom, "context").label).toBe(custom.label);
  });
});

describe("chartCaption — the reason a period is composed and not tabled", () => {
  // `overwriteGetLocale` is process-global (the same hazard `mock.module` is),
  // so this block owns it and hands it back. `format.test.ts` uses the same
  // door; "en" is what the default strategy resolves to under `bun test`.
  let locale: Locale = "en";
  overwriteGetLocale(() => locale);
  afterAll(() => overwriteGetLocale(() => "en"));

  test("a period caption is translated; the spec's baked English one is not", () => {
    // THE POINT of the composed path. `costRangeFor` bakes `${label}, by
    // ${bucket}` into every spec so the model stays free of the catalogue, and
    // the id-keyed table has no entry that can name "which August". A grain
    // falling through to the fallback therefore reads English in all five
    // locales, and nothing else in the app notices.
    locale = "en";
    const english = chartCaption(tab("month"), "detail");
    expect(english).toMatch(/, by day$/);

    locale = "de";
    const german = chartCaption(tab("month"), "detail");
    expect(german).not.toBe(english);
    expect(german).not.toMatch(/, by day$/);
    expect(german).toMatch(/, täglich$/);

    locale = "en";
  });

  test("the week title is the navigator's own, in the reader's language", () => {
    locale = "de";
    expect(chartCaption(tab("week"), "detail")).toMatch(/^Woche vom .+, täglich$/);
    locale = "en";
  });
});
