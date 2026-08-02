import { describe, expect, test } from "bun:test";
import { customCostRange, resolveCostPreset } from "$lib/cost/ranges";
import { includesNow, liveModeFor, shouldRevalidate } from "./live";

/** The module's default floor between two live-triggered refetches. */
const MINUTE = 60_000;

const NOW = new Date("2026-08-02T10:30:00");

describe("includesNow", () => {
  test("holds for every preset whose window runs up to now", () => {
    for (const id of ["today", "7d", "month", "year"]) {
      expect(includesNow(resolveCostPreset(id, NOW), NOW)).toBe(true);
    }
  });

  test("stays true once a preset window's captured end has aged", () => {
    // A preset is resolved once; its `to` is the wall clock at pick time, so a
    // minute later it lies in the past without the range having gone stale.
    const later = new Date(NOW.getTime() + 60_000);
    expect(includesNow(resolveCostPreset("month", NOW), later)).toBe(true);
  });

  test("is false for a closed preset window", () => {
    expect(includesNow(resolveCostPreset("lastMonth", NOW), NOW)).toBe(false);
  });

  test("follows the end boundary of a custom range", () => {
    // Ends today: the exclusive boundary is tomorrow's midnight, so it moves.
    const upToToday = customCostRange(new Date(2026, 6, 1), new Date(2026, 7, 2), NOW);
    expect(includesNow(upToToday, NOW)).toBe(true);
    const historical = customCostRange(new Date(2026, 5, 1), new Date(2026, 5, 30), NOW);
    expect(includesNow(historical, NOW)).toBe(false);
  });
});

describe("liveModeFor", () => {
  test("only the today preset is patched from the payload", () => {
    expect(liveModeFor(resolveCostPreset("today", NOW))).toBe("today");
    expect(liveModeFor(resolveCostPreset("7d", NOW))).toBe("window");
    expect(liveModeFor(resolveCostPreset("year", NOW))).toBe("window");
  });
});

describe("shouldRevalidate", () => {
  const now = 1_000_000;

  test("allows the first revalidation", () => {
    expect(shouldRevalidate(null, now)).toBe(true);
  });

  test("holds pushes inside the default one-minute window", () => {
    expect(shouldRevalidate(now - (MINUTE - 1), now)).toBe(false);
    expect(shouldRevalidate(now, now)).toBe(false);
  });

  test("lets a push through once the floor has passed", () => {
    expect(shouldRevalidate(now - MINUTE, now)).toBe(true);
    expect(shouldRevalidate(now - 10 * MINUTE, now)).toBe(true);
  });

  test("takes a custom floor", () => {
    expect(shouldRevalidate(now - 5_000, now, 1_000)).toBe(true);
    expect(shouldRevalidate(now - 500, now, 1_000)).toBe(false);
  });
});
