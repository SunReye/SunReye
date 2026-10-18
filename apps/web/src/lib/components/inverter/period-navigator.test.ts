/**
 * The period navigator's decisions. What the mounted control does with them —
 * which tab is lit, which arrow is dead, what a click reports — is
 * `period-navigator.svelte.test.ts`.
 *
 * The navigator replaces every range control on the dashboard with two rows:
 * four grain tabs, and a back/calendar/forward line where the DISABLED FORWARD
 * ARROW is the live indicator. The arrows' arithmetic, the live predicate and
 * the period title all live in `$lib/time/period` and are proven there; what is
 * decided here is which four tabs there are and what the header prints when the
 * reader is not standing on a calendar period at all.
 */

import { describe, expect, it } from "bun:test";
import { periodWindow, type Grain, type Period } from "$lib/time/period";
import {
  activeGrain,
  GRAIN_TABS,
  grainTabs,
  navigatorTitle,
  stepLabels,
  type GrainMessages,
} from "./period-navigator";

const BERLIN = "Europe/Berlin";
const OPTS = { timeZone: BERLIN, weekStartsOn: 1 as const };
/** A Sunday in August, so week/month/year windows are all unambiguous. */
const NOW = new Date("2026-08-19T10:00:00Z");

const period = (grain: Grain, instant: Date = NOW): Period => periodWindow(instant, grain, OPTS);

/** The catalogue, with each message spelled as itself so a swap is visible. */
const MESSAGES: GrainMessages = {
  day: () => "Day",
  week: () => "Week",
  month: () => "Month",
  year: () => "Year",
  today: () => "Today",
  weekOf: ({ date }) => `Week of ${date}`,
  prev: {
    day: () => "Previous day",
    week: () => "Previous week",
    month: () => "Previous month",
    year: () => "Previous year",
  },
  next: {
    day: () => "Next day",
    week: () => "Next week",
    month: () => "Next month",
    year: () => "Next year",
  },
};

describe("GRAIN_TABS — four tabs, and no fifth", () => {
  it("labels each tab from the catalogue, in the same order", () => {
    expect(grainTabs(MESSAGES)).toEqual([
      { id: "day", label: "Day" },
      { id: "week", label: "Week" },
      { id: "month", label: "Month" },
      { id: "year", label: "Year" },
    ]);
  });
});

describe("stepLabels — the arrows name the period they step", () => {
  it("takes each direction's name for THIS grain out of the catalogue", () => {
    // The mapping is the claim: a swapped pair, or a label built from the wrong
    // grain, is a control that announces the opposite of what it does.
    expect(stepLabels("month", MESSAGES)).toEqual({
      back: "Previous month",
      forward: "Next month",
    });
    expect(stepLabels("day", MESSAGES).back).toBe("Previous day");
    expect(stepLabels("year", MESSAGES).forward).toBe("Next year");
  });

  it("gives all four grains their own pair — eight distinct names", () => {
    const names = GRAIN_TABS.flatMap((grain) => Object.values(stepLabels(grain, MESSAGES)));
    expect(new Set(names).size).toBe(8);
  });

  it("never announces a bare 'period', which /statistics already has a button for", () => {
    // The Records section's compare-mode button has read "Previous period" since
    // before this control existed. Two buttons with one accessible name is a
    // screen-reader defect ("Previous period, button", twice, doing different
    // things) and an ambiguous locator for every spec on the route. The arrows
    // step a period at a GRAIN, so they say which.
    for (const grain of GRAIN_TABS) {
      const { back, forward } = stepLabels(grain, MESSAGES);
      expect(back).not.toBe("Previous period");
      expect(forward).not.toBe("Next period");
      expect(back).toContain(MESSAGES[grain]().toLowerCase());
    }
  });
});

describe("activeGrain — which tab is lit", () => {
  it("is the period's own grain when a calendar period is showing", () => {
    expect(activeGrain(period("day"), null)).toBe("day");
    expect(activeGrain(period("year"), null)).toBe("year");
  });

  it("is nothing at all while a preset or a custom range is showing", () => {
    // A 6-hour window and a 17-day comparison are not calendar periods. Lighting
    // the tab of the period the reader last stood on would claim they are.
    expect(activeGrain(period("month"), { id: "6h", label: "6 hours" })).toBeNull();
    expect(activeGrain(period("month"), { id: "custom", label: "Aug 2 – Aug 19" })).toBeNull();
  });
});

describe("navigatorTitle — what the calendar button prints", () => {
  const title = (p: Period, override: { id: string; label: string } | null = null) =>
    navigatorTitle(p, override, { ...OPTS, locale: "en-US", now: NOW }, MESSAGES);

  it("calls the period holding now Today, from the caller's own catalogue", () => {
    expect(title(period("day"))).toBe("Today");
  });

  it("names a past day by its date", () => {
    expect(title(period("day", new Date("2026-08-02T10:00:00Z")))).toBe("Aug 2");
  });

  it("names a week by the day it starts on", () => {
    // 19 Aug 2026 is a Wednesday; the Monday-start week begins on the 17th.
    expect(title(period("week"))).toBe("Week of Aug 17");
  });

  it("names a month and a year", () => {
    expect(title(period("month"))).toBe("Aug 2026");
    expect(title(period("year"))).toBe("2026");
  });

  it("prints the override's own label when one is showing", () => {
    // The preset and custom labels are already localized by the page (see
    // `$lib/cost/labels`), so they pass through rather than being re-derived.
    expect(title(period("day"), { id: "6h", label: "6 hours" })).toBe("6 hours");
    expect(title(period("day"), { id: "custom", label: "Aug 2 – Aug 19" })).toBe("Aug 2 – Aug 19");
  });
});
