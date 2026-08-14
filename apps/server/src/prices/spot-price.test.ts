import { describe, expect, test } from "bun:test";
import {
  SLOT_MINUTES,
  type SpotPriceSeries,
  buildSpotSlice,
  expectedSlotCount,
  localDayStartMs,
  nextLocalDayStartMs,
  toSpotRows,
  zoneTimeZone,
} from "./spot-price";

const BERLIN = "Europe/Berlin";
const QUARTER_MS = 900_000;
const HOUR_MS = 3_600_000;

/** `n` quarter-hour rows from `startMs`, all at `eurPerMwh`. */
const rows = (startMs: number, n: number, eurPerMwh = 50, slotMinutes = SLOT_MINUTES) =>
  Array.from({ length: n }, (_, i) => ({
    slotStart: new Date(startMs + i * QUARTER_MS),
    slotMinutes,
    eurPerMwh,
  }));

const series = (over: Partial<SpotPriceSeries> = {}): SpotPriceSeries => ({
  zone: "DE-LU",
  startMs: [0],
  eurPerMwh: [50],
  resolutionMinutes: 60,
  ...over,
});

/** The slice a fetched series would produce, so ingest is tested end to end. */
const sliceOf = (s: SpotPriceSeries, nowMs: number) =>
  buildSpotSlice(
    toSpotRows(s, "test").map((r) => ({
      slotStart: r.slotStart as Date,
      slotMinutes: r.slotMinutes,
      eurPerMwh: r.eurPerMwh,
    })),
    s.zone,
    nowMs,
  );

describe("market calendar", () => {
  test("zone maps to the market's time zone, not the server's", () => {
    expect(zoneTimeZone("DE-LU")).toBe(BERLIN);
    expect(zoneTimeZone("DE-AT-LU")).toBe(BERLIN);
    expect(zoneTimeZone("AT")).toBe("Europe/Vienna");
    expect(zoneTimeZone("SE3")).toBe("Europe/Stockholm");
    // An unknown zone falls back rather than throwing: a config from a newer
    // version must not take the feed down.
    expect(zoneTimeZone("ZZ")).toBe(BERLIN);
  });

  test("local day start resolves the offset at midnight, not at now", () => {
    // Spring-forward day: midnight is still CET (+1) while noon is CEST (+2), so
    // a single-offset calculation would land an hour out.
    expect(localDayStartMs(BERLIN, Date.parse("2026-03-29T10:00:00Z"))).toBe(
      Date.parse("2026-03-28T23:00:00Z"),
    );
    // Autumn: midnight is CEST (+2), the afternoon is CET (+1).
    expect(localDayStartMs(BERLIN, Date.parse("2026-10-25T09:00:00Z"))).toBe(
      Date.parse("2026-10-24T22:00:00Z"),
    );
    expect(localDayStartMs(BERLIN, Date.parse("2026-06-10T22:30:00Z"))).toBe(
      Date.parse("2026-06-10T22:00:00Z"),
    );
  });

  test("next local day start crosses a DST seam", () => {
    expect(nextLocalDayStartMs(BERLIN, Date.parse("2026-03-29T10:00:00Z"))).toBe(
      Date.parse("2026-03-29T22:00:00Z"),
    );
    expect(nextLocalDayStartMs(BERLIN, Date.parse("2026-10-25T09:00:00Z"))).toBe(
      Date.parse("2026-10-25T23:00:00Z"),
    );
  });

  test("expected slot count is DST-aware with no special case", () => {
    const day = (isoNow: string, resolution = SLOT_MINUTES) => {
      const now = Date.parse(isoNow);
      return expectedSlotCount(
        localDayStartMs(BERLIN, now),
        nextLocalDayStartMs(BERLIN, now),
        resolution,
      );
    };
    expect(day("2026-06-10T12:00:00Z")).toBe(96);
    expect(day("2026-03-29T10:00:00Z")).toBe(92); // 23-hour day
    expect(day("2026-10-25T09:00:00Z")).toBe(100); // 25-hour day
    expect(day("2026-10-25T09:00:00Z", 60)).toBe(25);
  });
});

describe("ingest onto the quarter-hour grid", () => {
  const now = Date.parse("2026-06-10T09:00:00Z");
  const todayStart = localDayStartMs(BERLIN, now);

  test("a quarter-hourly series is stored slot for slot", () => {
    const out = toSpotRows(
      series({ resolutionMinutes: 15, startMs: [0, QUARTER_MS], eurPerMwh: [1, 2] }),
      "test",
    );
    expect(out.map((r) => r.eurPerMwh)).toEqual([1, 2]);
    expect(out.map((r) => r.slotMinutes)).toEqual([15, 15]);
  });

  test("an hourly series fans out to four repeated slots", () => {
    const out = toSpotRows(series({ startMs: [0, HOUR_MS], eurPerMwh: [-12, 40] }), "test");
    expect(out.map((r) => (r.slotStart as Date).getTime())).toEqual([
      0,
      QUARTER_MS,
      2 * QUARTER_MS,
      3 * QUARTER_MS,
      HOUR_MS,
      HOUR_MS + QUARTER_MS,
      HOUR_MS + 2 * QUARTER_MS,
      HOUR_MS + 3 * QUARTER_MS,
    ]);
    expect(out.map((r) => r.eurPerMwh)).toEqual([-12, -12, -12, -12, 40, 40, 40, 40]);
    // The *source* width is preserved so the UI can admit that a negative
    // quarter-hour inside a positive hour was never resolvable.
    expect(out.every((r) => r.slotMinutes === 60)).toBe(true);
  });

  test("rows carry the instant, the source width and the provider", () => {
    const [first] = toSpotRows(series({ startMs: [0], eurPerMwh: [-8.5] }), "energy-charts");
    expect(first).toEqual({
      zone: "DE-LU",
      slotStart: new Date(0),
      slotMinutes: 60,
      eurPerMwh: -8.5,
      provider: "energy-charts",
    });
  });

  test("a slot with no price is dropped, never defaulted to zero", () => {
    const out = toSpotRows(series({ startMs: [0, HOUR_MS], eurPerMwh: [Number.NaN, 40] }), "test");
    expect(out).toHaveLength(4);
    expect(out.every((r) => r.eurPerMwh === 40)).toBe(true);
  });

  test("a gap in the series does not stretch a slot across it", () => {
    // The second slot starts three hours later: the first must stay one hour
    // wide rather than smearing over the hole.
    const out = toSpotRows(series({ startMs: [0, 3 * HOUR_MS], eurPerMwh: [10, 20] }), "test");
    expect(out.filter((r) => (r.slotStart as Date).getTime() < HOUR_MS)).toHaveLength(4);
  });

  test("an hourly source still yields a complete day", () => {
    const startMs = Array.from({ length: 24 }, (_, i) => todayStart + i * HOUR_MS);
    const slice = sliceOf(
      series({ startMs, eurPerMwh: startMs.map(() => 30), resolutionMinutes: 60 }),
      now,
    );
    expect(slice.series).toHaveLength(96);
    expect(slice.coverage.today).toBe("complete");
    // ...but every slot admits it came from an hourly source.
    expect(slice.series.every((p) => p.minutes === 60)).toBe(true);
  });
});

describe("buildSpotSlice", () => {
  const now = Date.parse("2026-06-10T09:00:00Z");
  const todayStart = localDayStartMs(BERLIN, now);
  const tomorrowStart = nextLocalDayStartMs(BERLIN, now);

  test("a full two days is complete and plannable", () => {
    const slice = buildSpotSlice(
      [...rows(todayStart, 96), ...rows(tomorrowStart, 96)],
      "DE-LU",
      now,
    );
    expect(slice.coverage).toEqual({ today: "complete", tomorrow: "complete" });
    expect(slice.availability).toBe("ok");
    expect(slice.stepMinutes).toBe(SLOT_MINUTES);
    expect(slice.utcOffsetSeconds).toBe(7200);
  });

  test("winter carries the standard-time offset", () => {
    const winter = Date.parse("2026-01-15T09:00:00Z");
    const slice = buildSpotSlice(rows(localDayStartMs(BERLIN, winter), 4), "DE-LU", winter);
    expect(slice.utcOffsetSeconds).toBe(3600);
  });

  test("tomorrow unpublished degrades to today-only, not to ok", () => {
    const slice = buildSpotSlice(rows(todayStart, 96), "DE-LU", now);
    expect(slice.coverage).toEqual({ today: "complete", tomorrow: "missing" });
    expect(slice.availability).toBe("today-only");
  });

  test("a partial day is partial, never complete", () => {
    const slice = buildSpotSlice(rows(todayStart, 40), "DE-LU", now);
    expect(slice.coverage.today).toBe("partial");
  });

  test("no rows at all is availability none", () => {
    const slice = buildSpotSlice([], "DE-LU", now);
    expect(slice.availability).toBe("none");
    expect(slice.series).toEqual([]);
  });

  test("negative is strictly below zero — a slot at 0.00 still pays", () => {
    const slice = buildSpotSlice(
      [
        ...rows(todayStart, 1, -0.01),
        ...rows(todayStart + QUARTER_MS, 1, 0),
        ...rows(todayStart + 2 * QUARTER_MS, 1, 12),
      ],
      "DE-LU",
      now,
    );
    expect(slice.series.map((p) => p.negative)).toEqual([true, false, false]);
  });

  test("series is sorted by instant regardless of row order", () => {
    const slice = buildSpotSlice(
      [...rows(todayStart + 4 * QUARTER_MS, 1), ...rows(todayStart, 1)],
      "DE-LU",
      now,
    );
    expect(slice.series.map((p) => p.startMs)).toEqual([todayStart, todayStart + 4 * QUARTER_MS]);
  });

  test("a 23-hour day is complete at 92 slots", () => {
    const spring = Date.parse("2026-03-29T10:00:00Z");
    const slice = buildSpotSlice(rows(localDayStartMs(BERLIN, spring), 92), "DE-LU", spring);
    expect(slice.coverage.today).toBe("complete");
  });

  test("the repeated local hour keeps distinct instants under one label", () => {
    const autumn = Date.parse("2026-10-25T09:00:00Z");
    // 02:00 CEST and 02:00 CET are an hour apart but label identically.
    const first = Date.parse("2026-10-25T00:30:00Z");
    const second = Date.parse("2026-10-25T01:30:00Z");
    const slice = buildSpotSlice([...rows(first, 1, 10), ...rows(second, 1, 20)], "DE-LU", autumn);
    expect(slice.series.map((p) => p.time)).toEqual(["2026-10-25T02:30", "2026-10-25T02:30"]);
    expect(slice.series.map((p) => p.startMs)).toEqual([first, second]);
  });
});
