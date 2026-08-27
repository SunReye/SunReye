/**
 * The period navigator's decisions, and the one convention that only exists as
 * markup.
 *
 * The navigator replaces every range control on the dashboard with two rows:
 * four grain tabs, and a back/calendar/forward line where the DISABLED FORWARD
 * ARROW is the live indicator. The arrows' arithmetic, the live predicate and
 * the period title all live in `$lib/time/period` and are proven there; what is
 * decided here is which four tabs there are, what the header prints when the
 * reader is not standing on a calendar period at all, and how a four-option row
 * survives 390px.
 */

import { describe, expect, it } from "bun:test";
import { SEGMENTED_MAX_OPTIONS } from "$lib/layout/tokens";
import { periodWindow, type Grain, type Period } from "$lib/time/period";
import {
  activeGrain,
  GRAIN_ROW,
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
  it("is day, week, month, year in that order", () => {
    // Finest first, so the row reads left to right as zooming out. There is
    // deliberately no "Live" tab: standing on the current period IS live, and
    // the disabled forward arrow is what says so.
    expect(GRAIN_TABS).toEqual(["day", "week", "month", "year"]);
  });

  it("labels each tab from the catalogue, in the same order", () => {
    expect(grainTabs(MESSAGES)).toEqual([
      { id: "day", label: "Day" },
      { id: "week", label: "Week" },
      { id: "month", label: "Month" },
      { id: "year", label: "Year" },
    ]);
  });
});

describe("the grain row's phone form", () => {
  // `SEGMENTED_MAX_OPTIONS` is 3 and governs `RangeSwitcher`, which offers a
  // Select on a phone past it: its options are a WRAPPING flex row, and a
  // fourth chip landing on a second line reads as a separate control. This row
  // is four options by design and must not bend that token, so it is not a
  // wrapping row at all — it is an equal-column grid, which cannot wrap.
  it("carries more options than a wrapping segmented row may", () => {
    expect(GRAIN_TABS.length).toBeGreaterThan(SEGMENTED_MAX_OPTIONS);
  });

  it("gives every tab its own column instead of letting the row wrap", () => {
    expect(GRAIN_ROW).toContain(`grid-cols-${GRAIN_TABS.length}`);
    expect(GRAIN_ROW).toContain("grid");
    expect(GRAIN_ROW).not.toContain("wrap");
  });

  it("states the column count for the phone, not only from a breakpoint", () => {
    // The rule `lib/layout/mobile-density.test.ts` holds the whole tree to: a
    // bare `sm:grid-cols-4` is one column below sm by accident, not by decision.
    expect(GRAIN_ROW).not.toMatch(/(?:^|\s)(?:sm|lg|xl|2xl):grid-cols-/);
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

/** The component's own source — the only place a markup convention can be read. */
const code = await Bun.file(new URL("./period-navigator.svelte", import.meta.url)).text();

describe("the component spends the decisions rather than restating them", () => {
  /** The opening tag of the element that renders the grain tabs. */
  const grainRowTag = code.match(/<div[^>]*\{GRAIN_ROW\}[^>]*>/)?.[0] ?? "";

  it("renders the tab row through GRAIN_ROW, not a hand-typed grid", () => {
    expect(grainRowTag).not.toBe("");
    expect(code).not.toMatch(/class="[^"]*grid-cols-4/);
  });

  it("draws one tab per GRAIN_TABS entry rather than four literal buttons", () => {
    // Four hand-written buttons would drift from GRAIN_TABS silently — the row
    // would keep four tabs while the model grew or lost a grain.
    expect(code).toMatch(/\{#each grainTabs\(|\{#each tabs as/);
    expect(code).toContain("grainTabs(");
  });

  it("keeps its tabs and arrows thumb-height on a phone", () => {
    // The 44px floor: interactive rows gain a step below sm and hand it back.
    // `h-8 sm:h-7` here would be a 32px tab under a thumb. The `sm` half is
    // `h-full` now — from sm the navigator is one row of a fixed height and both
    // halves fill it — so what is pinned here is the phone number.
    expect(code).toMatch(/h-9 sm:h-full/);
    expect(code).not.toMatch(/(?:^|\s)h-8 sm:h-7/);
  });

  it("disables the forward arrow through canStepForward, not a hand-rolled compare", () => {
    // The live rule — false at BOTH ends of the current period, false for a
    // period wholly ahead of now — is proven in `$lib/time/period`. A local
    // `period.end < now` here is the one-token version of it that is wrong at
    // the instant the period closes.
    expect(code).toContain("canStepForward(");
    expect(code).not.toMatch(/\.end(?:\.getTime\(\))?\s*<[^=]/);
  });
});
