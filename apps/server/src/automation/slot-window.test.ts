import { describe, expect, test } from "bun:test";
import { type ForecastSlice, remainingSlotsToday } from "./slot-window";

// A forecast's `time[]` strings are UTC shifted by ONE fixed offset for the whole
// series (verified against live Open-Meteo), so on a DST-change day they stop
// matching the plant's wall clock. The plant-local day must come from the zone.
const BERLIN = "Europe/Berlin";
const QUARTER_MS = 15 * 60_000;

/** 15-min slots from `fromUtc`, labelled at the series' single fixed offset. */
function sliceAt(fromUtc: string, count: number, utcOffsetSeconds: number): ForecastSlice {
  const startMs = Date.parse(fromUtc);
  return {
    stepMinutes: 15,
    utcOffsetSeconds,
    timeZone: BERLIN,
    series: Array.from({ length: count }, (_, i) => ({
      time: new Date(startMs + i * QUARTER_MS + utcOffsetSeconds * 1000).toISOString().slice(0, 16),
      watts: 1000,
      peakWatts: 1000,
    })),
  };
}

const startsOf = (view: ForecastSlice, fromMs: number): string[] =>
  remainingSlotsToday(view, fromMs).map((s) => new Date(s.startMs).toISOString());

describe("remainingSlotsToday across a DST change", () => {
  test("spring-forward: today ends at CEST midnight, not the CET-labelled one", () => {
    // Fetched the day before, the series carries CET (+01:00). Berlin's 30 March
    // starts at 2026-03-29T22:00Z (CEST), where the labels still read 23:00 on the 29th.
    const view = sliceAt("2026-03-29T20:00:00Z", 12, 3600);
    const starts = startsOf(view, Date.parse("2026-03-29T20:00:00Z"));
    expect(starts).toHaveLength(8);
    expect(starts.at(-1)).toBe("2026-03-29T21:45:00.000Z");
  });

  test("fall-back: the hour labelled 00:00 at +02:00 is still today in CET", () => {
    // Fetched the day before, the series carries CEST (+02:00). Berlin's 26 October
    // starts at 2026-10-25T23:00Z (CET); the 22:00Z hour is 23:00 on the 25th.
    const view = sliceAt("2026-10-25T21:00:00Z", 12, 7200);
    const starts = startsOf(view, Date.parse("2026-10-25T21:00:00Z"));
    expect(starts).toHaveLength(8);
    expect(starts.at(-1)).toBe("2026-10-25T22:45:00.000Z");
  });

  test("slot instants stay the fixed-offset decode of the labels", () => {
    const view = sliceAt("2026-10-25T21:00:00Z", 4, 7200);
    const [first] = remainingSlotsToday(view, Date.parse("2026-10-25T21:00:00Z"));
    expect(first?.startMs).toBe(Date.parse("2026-10-25T21:00:00Z"));
    expect(first?.remainingMs).toBe(QUARTER_MS);
  });

  test("an ordinary day is unchanged", () => {
    const view = sliceAt("2026-07-25T20:00:00Z", 12, 7200);
    // Local midnight of 26 July is 22:00Z: 8 quarter slots left from 20:00Z.
    expect(startsOf(view, Date.parse("2026-07-25T20:00:00Z"))).toHaveLength(8);
  });

  test("an empty series yields no slots", () => {
    expect(remainingSlotsToday(sliceAt("2026-03-29T20:00:00Z", 0, 3600), 0)).toEqual([]);
  });
});
