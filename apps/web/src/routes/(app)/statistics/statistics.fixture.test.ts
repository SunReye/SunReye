import { describe, expect, test } from "bun:test";
import { FAKE_API, fakeSectionData, fakeStatisticsQuery } from "./statistics.fixture";

// The fixture's contract: every read answers, so a section that stays away was gated, not empty.
describe("statistics fixture", () => {
  test("every API read answers with a data envelope", async () => {
    const reads = [
      FAKE_API.comparison({} as never),
      FAKE_API.costSeries({} as never),
      FAKE_API.energySeries({} as never),
      FAKE_API.records({} as never),
      FAKE_API.amortisation({} as never),
      FAKE_API.heatmap({} as never),
      FAKE_API.spotStats({} as never),
      FAKE_API.dayAheadPrices(),
      FAKE_API.batteryHealth(),
    ];
    for (const answer of await Promise.all(reads)) expect(answer).toHaveProperty("data");
  });

  test("the heatmap has a drawn slot and the battery health a trend", async () => {
    expect(((await FAKE_API.heatmap({} as never)).data as unknown[]).length).toBe(1);
    const health = (await FAKE_API.batteryHealth()).data as {
      trend: unknown[];
    };
    expect(health.trend.length).toBe(2);
  });

  test("the query is built over the fake API", () => {
    expect(typeof fakeStatisticsQuery().comparison).toBe("function");
  });

  test("the section data is an empty August window in UTC", () => {
    const data = fakeSectionData();
    expect(data.range.timeZone).toBe("UTC");
    expect(data.range.from.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(data.cost.loadKwh).toBe(0);
    expect(data.previous).toBeNull();
    expect(data.windowDays).toBe(14);
  });
});
