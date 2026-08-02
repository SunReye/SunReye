import { describe, expect, test } from "bun:test";
import { presetLabel, rangeCaption } from "./labels";
import { customCostRange, resolveCostPreset } from "./ranges";

describe("presetLabel", () => {
  test("names a known preset in the UI locale", () => {
    expect(presetLabel("month", "This month")).toBe("This month");
  });

  test("falls back to the range's own label for a custom range", () => {
    expect(presetLabel("custom", "Aug 1 – Aug 3")).toBe("Aug 1 – Aug 3");
  });
});

describe("rangeCaption", () => {
  const now = new Date(2026, 7, 2, 19, 30);

  test("reads the last covered day, not the exclusive end", () => {
    // Last month is [Jul 1, Aug 1) — the caption must say Jul 31.
    expect(rangeCaption(resolveCostPreset("lastMonth", now), "previous")).toBe(
      "Jul 1 – Jul 31 · vs the previous 31 days",
    );
  });

  test("collapses to one date when the window is a single day", () => {
    const range = customCostRange(new Date(2026, 7, 2), new Date(2026, 7, 2), now);
    expect(rangeCaption(range, "previous")).toBe("Aug 2 · vs yesterday");
  });

  test("names the year-ago window when that is the comparison", () => {
    expect(rangeCaption(resolveCostPreset("today", now), "yearAgo")).toBe(
      "Aug 2 · vs the same period a year ago",
    );
  });
});
