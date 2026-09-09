import { describe, expect, test } from "bun:test";
import { clearSkyDayWeight, seasonalGaps, solarYears } from "./seasonal-weight";

/** A Frankfurt roof: 8 kWp due south at 30°. */
const FRANKFURT = { latitude: 50.1, longitude: 8.7 };
const SOUTH = [{ kwp: 8, tilt: 30, azimuth: 0 }];

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("clearSkyDayWeight", () => {
  test("a June day yields several times a December day at 50° N", () => {
    const june = clearSkyDayWeight(FRANKFURT, SOUTH, day("2025-06-21"));
    const december = clearSkyDayWeight(FRANKFURT, SOUTH, day("2025-12-21"));
    expect(june).toBeGreaterThan(december * 2.5);
    expect(december).toBeGreaterThan(0);
  });

  test("scales with the installed power, so arrays weight each other by size", () => {
    const one = clearSkyDayWeight(FRANKFURT, SOUTH, day("2025-06-21"));
    const two = clearSkyDayWeight(FRANKFURT, [{ ...SOUTH[0]!, kwp: 16 }], day("2025-06-21"));
    expect(two).toBeCloseTo(one * 2, 6);
  });

  test("an east and a west array together are flatter over the day than south alone", () => {
    // Both halves see the sun, but never at full incidence; the day total stays
    // in the same order of magnitude and below a south roof of equal size.
    const south = clearSkyDayWeight(FRANKFURT, SOUTH, day("2025-06-21"));
    const eastWest = clearSkyDayWeight(
      FRANKFURT,
      [
        { kwp: 4, tilt: 30, azimuth: -90 },
        { kwp: 4, tilt: 30, azimuth: 90 },
      ],
      day("2025-06-21"),
    );
    expect(eastWest).toBeLessThan(south);
    expect(eastWest).toBeGreaterThan(south * 0.6);
  });

  test("the seasons flip south of the equator", () => {
    // Sydney, panels facing north (±180 in the project's convention).
    const sydney = { latitude: -33.9, longitude: 151.2 };
    const north = [{ kwp: 5, tilt: 25, azimuth: 180 }];
    expect(clearSkyDayWeight(sydney, north, day("2025-12-21"))).toBeGreaterThan(
      clearSkyDayWeight(sydney, north, day("2025-06-21")),
    );
  });

  test("polar night weighs nothing", () => {
    expect(clearSkyDayWeight({ latitude: 78, longitude: 15 }, SOUTH, day("2025-12-21"))).toBe(0);
  });
});

describe("solarYears", () => {
  test("a full calendar year is exactly one solar year", () => {
    expect(solarYears(FRANKFURT, SOUTH, day("2025-01-01"), day("2026-01-01"))).toBeCloseTo(1, 6);
    // Leap years do not change what a year is worth.
    expect(solarYears(FRANKFURT, SOUTH, day("2024-01-01"), day("2025-01-01"))).toBeCloseTo(1, 2);
  });

  test("the summer half-year is worth well over half a year, the winter half well under", () => {
    const summer = solarYears(FRANKFURT, SOUTH, day("2025-04-01"), day("2025-10-01"));
    const winter = solarYears(FRANKFURT, SOUTH, day("2025-10-01"), day("2026-04-01"));
    expect(summer).toBeGreaterThan(0.6);
    expect(winter).toBeLessThan(0.4);
    expect(summer + winter).toBeCloseTo(1, 6);
  });

  test("several years add up, partial years included", () => {
    const two = solarYears(FRANKFURT, SOUTH, day("2024-05-17"), day("2026-05-17"));
    expect(two).toBeCloseTo(2, 2);
    const twoAndSummer = solarYears(FRANKFURT, SOUTH, day("2024-05-17"), day("2026-09-17"));
    expect(twoAndSummer).toBeGreaterThan(2.34); // 4 summer months > 4/12 of a year
    expect(twoAndSummer).toBeLessThan(2.6);
  });

  test("an empty or inverted window is zero", () => {
    expect(solarYears(FRANKFURT, SOUTH, day("2025-06-01"), day("2025-06-01"))).toBe(0);
    expect(solarYears(FRANKFURT, SOUTH, day("2025-06-02"), day("2025-06-01"))).toBe(0);
  });

  test("a window is counted in whole UTC days from its start", () => {
    // Half a day in: the day it started still counts once, as the calendar does.
    const oneDay = solarYears(FRANKFURT, SOUTH, day("2025-06-21"), day("2025-06-22"));
    const halfIn = solarYears(
      FRANKFURT,
      SOUTH,
      new Date("2025-06-21T12:00:00Z"),
      new Date("2025-06-22T12:00:00Z"),
    );
    expect(halfIn).toBeCloseTo(oneDay, 6);
  });
});

describe("seasonalGaps", () => {
  const ready = { enabled: true, latitude: 50.1, longitude: 8.7, forecast: { arrays: SOUTH } };

  test("a configured roof has no gaps", () => {
    expect(seasonalGaps(ready)).toEqual([]);
  });

  test("names every missing prerequisite at once, in settings order", () => {
    expect(seasonalGaps({ ...ready, enabled: false })).toEqual(["weather"]);
    expect(seasonalGaps({ ...ready, latitude: null })).toEqual(["location"]);
    expect(seasonalGaps({ ...ready, longitude: null })).toEqual(["location"]);
    expect(seasonalGaps({ ...ready, forecast: { arrays: [] } })).toEqual(["arrays"]);
    expect(
      seasonalGaps({ enabled: false, latitude: null, longitude: null, forecast: { arrays: [] } }),
    ).toEqual(["weather", "location", "arrays"]);
  });
});
