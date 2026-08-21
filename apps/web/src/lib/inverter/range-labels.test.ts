import { afterAll, describe, expect, test } from "bun:test";
import { overwriteGetLocale } from "$lib/paraglide/runtime";
import { historyPresetLabel, historyPresets } from "./range-labels";
import { KEPT_PRESETS } from "./ranges";

describe("historyPresets", () => {
  test("offers exactly the presets the model keeps, in its order", () => {
    expect(historyPresets().map((p) => p.id)).toEqual(KEPT_PRESETS.map((p) => p.id));
  });

  test("every kept preset carries a localized name, not the model's English one", () => {
    // `$lib/inverter/ranges` bakes an English `label` into every preset so the
    // model stays free of the catalogue. That fallback is a safety net, not a
    // shipping path: a preset kept without a message would read English in all
    // five locales, and nothing else in the app would notice.
    for (const preset of KEPT_PRESETS) {
      expect(historyPresetLabel(preset.id, "MISSING")).not.toBe("MISSING");
    }
  });

  test("names the four rolling windows a calendar grain cannot express", () => {
    expect(historyPresets().map((p) => p.label)).toEqual([
      "1 hour",
      "6 hours",
      "Last 14 days",
      "Last 6 months",
    ]);
  });

  test("spends the CATALOGUE for those names, not the baked English", () => {
    // The same hole `$lib/cost/labels`' German case closes, in the sibling
    // module: every English message here is word-for-word the label baked into
    // the model, so dropping the localization call from `historyPresets` leaves
    // the case above green and ships an untranslated popover. German cannot be
    // green for it. `overwriteGetLocale` is process-global, so it is set inside
    // the case and handed back below.
    overwriteGetLocale(() => "de");
    const labels = historyPresets().map((p) => p.label);
    expect(labels).toEqual(KEPT_PRESETS.map((p) => historyPresetLabel(p.id, p.label)));
    expect(labels).not.toEqual(KEPT_PRESETS.map((p) => p.label));
  });

  afterAll(() => overwriteGetLocale(() => "en"));
});

describe("historyPresetLabel", () => {
  test("falls back to the caller's label for an id with no message", () => {
    // The zoom window and a custom span arrive here with a label the UI already
    // formatted; there is no catalogue entry for either.
    expect(historyPresetLabel("zoom", "10:05 – 10:25")).toBe("10:05 – 10:25");
    expect(historyPresetLabel("custom", "May 1 – May 3")).toBe("May 1 – May 3");
  });
});
