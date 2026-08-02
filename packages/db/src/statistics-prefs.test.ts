import { describe, expect, test } from "bun:test";

import { defaultStatisticsPrefs, statisticsPrefsSchema } from "./statistics-prefs";

describe("statistics prefs", () => {
  test("empty blob parses to the full defaults", () => {
    expect(statisticsPrefsSchema.parse({})).toEqual({
      hiddenSections: [],
      hiddenTiles: [],
      collapsedSections: [],
      cost: { chartScope: "detail" },
      energy: { bucket: "day", chartScope: "detail", heatmapField: "load" },
      prices: { windowDays: 90 },
      records: { compareMode: "previous", yoyMetric: "net" },
    });
    expect(defaultStatisticsPrefs).toEqual(statisticsPrefsSchema.parse({}));
  });

  test("partial blob parses with defaults filled", () => {
    const parsed = statisticsPrefsSchema.parse({
      hiddenSections: ["prices"],
      energy: { heatmapField: "export" },
    });
    expect(parsed.hiddenSections).toEqual(["prices"]);
    expect(parsed.hiddenTiles).toEqual([]);
    expect(parsed.collapsedSections).toEqual([]);
    expect(parsed.energy).toEqual({ bucket: "day", chartScope: "detail", heatmapField: "export" });
    expect(parsed.cost).toEqual({ chartScope: "detail" });
    expect(parsed.prices).toEqual({ windowDays: 90 });
    expect(parsed.records).toEqual({ compareMode: "previous", yoyMetric: "net" });
  });

  test("round-trips a populated config", () => {
    const input = {
      hiddenSections: ["records"],
      hiddenTiles: ["cost.solarSavings"],
      collapsedSections: ["energy"],
      cost: { chartScope: "context" },
      energy: { bucket: "month", chartScope: "context", heatmapField: "production" },
      prices: { windowDays: 365 },
      records: { compareMode: "yearAgo", yoyMetric: "production" },
    };
    expect(statisticsPrefsSchema.parse(input)).toEqual(input);
  });

  test("rejects unknown keys, bad enums, and out-of-range windows", () => {
    expect(statisticsPrefsSchema.safeParse({ extra: true }).success).toBe(false);
    expect(statisticsPrefsSchema.safeParse({ cost: { chartScope: "zoomed" } }).success).toBe(false);
    expect(statisticsPrefsSchema.safeParse({ energy: { heatmapField: "battery" } }).success).toBe(
      false,
    );
    expect(statisticsPrefsSchema.safeParse({ prices: { windowDays: 6 } }).success).toBe(false);
    expect(statisticsPrefsSchema.safeParse({ prices: { windowDays: 1096 } }).success).toBe(false);
    expect(statisticsPrefsSchema.safeParse({ prices: { windowDays: 90.5 } }).success).toBe(false);
    expect(statisticsPrefsSchema.safeParse({ hiddenTiles: [1] }).success).toBe(false);
  });

  test("enum defaults pinned", () => {
    expect(defaultStatisticsPrefs.cost.chartScope).toBe("detail");
    expect(defaultStatisticsPrefs.energy.bucket).toBe("day");
    expect(defaultStatisticsPrefs.energy.chartScope).toBe("detail");
    expect(defaultStatisticsPrefs.energy.heatmapField).toBe("load");
    expect(defaultStatisticsPrefs.prices.windowDays).toBe(90);
    expect(defaultStatisticsPrefs.records.compareMode).toBe("previous");
    expect(defaultStatisticsPrefs.records.yoyMetric).toBe("net");
  });
});
