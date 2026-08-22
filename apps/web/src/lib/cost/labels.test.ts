import { afterAll, describe, expect, test } from "bun:test";
import { overwriteGetLocale } from "$lib/paraglide/runtime";
import { browserTimeZone } from "$lib/time/browser-zone";
import { periodWindow, stepPeriod, type Grain } from "$lib/time/period";
import { presetLabel, rangeCaption, statisticsPresets } from "./labels";
import { COST_PRESETS, costRangeFor, customCostRange } from "./ranges";

describe("presetLabel", () => {
  test("names the kept preset in the UI locale", () => {
    expect(presetLabel("7d", "Last 7 days")).toBe("Last 7 days");
  });

  test("falls back to the range's own label for a custom range", () => {
    expect(presetLabel("custom", "Aug 1 – Aug 3")).toBe("Aug 1 – Aug 3");
  });
});

describe("statisticsPresets", () => {
  test("offers exactly the presets the model keeps, in its order", () => {
    expect(statisticsPresets().map((p) => p.id)).toEqual(COST_PRESETS.map((p) => p.id));
  });

  test("every kept preset carries a localized name, not the model's English one", () => {
    // The English label baked into the model is a safety net, not a shipping
    // path: a preset kept without a message reads English in all five locales.
    for (const preset of COST_PRESETS) {
      expect(presetLabel(preset.id, "MISSING")).not.toBe("MISSING");
    }
  });

  test("spends the CATALOGUE for the popover's labels, not the baked English", () => {
    // Asserted in GERMAN, and that is the whole case. The English message and
    // the label baked into `COST_PRESETS` are the same words, so
    // `presets.map((p) => p.label)` — the localization call dropped entirely —
    // is green against English and ships an untranslated popover. It cannot be
    // green here. `overwriteGetLocale` is process-global (the hazard
    // `mock.module` has), so it is set inside the case and handed back below.
    overwriteGetLocale(() => "de");
    const labels = statisticsPresets().map((p) => p.label);
    expect(labels).toEqual(COST_PRESETS.map((p) => presetLabel(p.id, p.label)));
    expect(labels).not.toEqual(COST_PRESETS.map((p) => p.label));
  });

  afterAll(() => overwriteGetLocale(() => "en"));
});

describe("rangeCaption", () => {
  const now = new Date(2026, 7, 2, 19, 30);
  const OPTS = { timeZone: browserTimeZone() };
  /** The period the navigator's tab is standing on, `back` presses earlier. */
  const tab = (grain: Grain, back = 0) => {
    const here = periodWindow(now, grain, OPTS);
    return costRangeFor(back === 0 ? here : stepPeriod(here, -back, OPTS), now);
  };

  test("reads the last covered day, not the exclusive end", () => {
    // The Month tab, one back-press: [Jul 1, Aug 1) — the caption must say Jul 31.
    expect(rangeCaption(tab("month", 1), "previous", now)).toBe(
      "Jul 1 – Jul 31 · vs the previous 31 days",
    );
  });

  test("names the days that have HAPPENED for a period still running", () => {
    // The current month's window ends on 1 September so the chart axis is a
    // settled month. The caption is about the figures beside it, which stop at
    // now — "Aug 1 – Aug 31 · vs the previous 31 days" would describe neither
    // the totals shown nor the window the server compared.
    expect(rangeCaption(tab("month"), "previous", now)).toBe(
      "Aug 1 – Aug 2 · vs the previous 2 days",
    );
  });

  test("collapses to one date when the window is a single day", () => {
    const range = customCostRange(new Date(2026, 7, 2), new Date(2026, 7, 2), now);
    expect(rangeCaption(range, "previous", now)).toBe("Aug 2 · vs yesterday");
  });

  test("names the year-ago window when that is the comparison", () => {
    expect(rangeCaption(tab("day"), "yearAgo", now)).toBe("Aug 2 · vs the same period a year ago");
  });

  test("still spans an arbitrary custom range — the reason the baseline is span-driven", () => {
    // "vs the previous 17 days" only exists because a reader can pick 17 days.
    const range = customCostRange(new Date(2026, 6, 17), new Date(2026, 7, 2), now);
    expect(rangeCaption(range, "previous", now)).toBe("Jul 17 – Aug 2 · vs the previous 17 days");
  });
});
