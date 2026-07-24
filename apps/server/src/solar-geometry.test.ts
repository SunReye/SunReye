import { describe, expect, test } from "bun:test";
import { cosAoi, sunPosition } from "./solar-geometry";

// 48°N / 15°E — solar noon lands near 11:00 UTC (lon offset −1 h, EoT ≈ −2 min).
const LAT = 48;
const LON = 15;

describe("sunPosition", () => {
  test("summer solstice noon: elevation ≈ 90 − lat + declination, azimuth ≈ south", () => {
    const sun = sunPosition(LAT, LON, Date.parse("2026-06-21T11:00:00Z"));
    expect(sun.elevationDeg).toBeCloseTo(90 - LAT + 23.44, 0);
    expect(Math.abs(sun.azimuthDeg)).toBeLessThan(3);
  });

  test("winter solstice noon: declination flips sign", () => {
    const sun = sunPosition(LAT, LON, Date.parse("2026-12-21T11:00:00Z"));
    expect(sun.elevationDeg).toBeCloseTo(90 - LAT - 23.44, 0);
  });

  test("midnight: sun below the horizon", () => {
    const sun = sunPosition(LAT, LON, Date.parse("2026-06-21T23:00:00Z"));
    expect(sun.elevationDeg).toBeLessThan(0);
  });

  test("morning east, evening west (project azimuth convention)", () => {
    const morning = sunPosition(LAT, LON, Date.parse("2026-06-21T06:00:00Z"));
    const evening = sunPosition(LAT, LON, Date.parse("2026-06-21T16:00:00Z"));
    expect(morning.azimuthDeg).toBeLessThan(-45);
    expect(evening.azimuthDeg).toBeGreaterThan(45);
  });
});

describe("cosAoi", () => {
  test("1 when the panel points straight at the sun", () => {
    // Sun at 60° elevation due south; a south panel tilted 30° faces it dead-on.
    expect(cosAoi({ elevationDeg: 60, azimuthDeg: 0 }, 30, 0)).toBeCloseTo(1, 6);
  });

  test("horizontal panel: cosine of the zenith angle", () => {
    expect(cosAoi({ elevationDeg: 30, azimuthDeg: 70 }, 0, 0)).toBeCloseTo(
      Math.sin((30 * Math.PI) / 180),
      6,
    );
  });

  test("negative when the sun is behind the plane", () => {
    // Low southern sun on a steep north-facing panel.
    expect(cosAoi({ elevationDeg: 20, azimuthDeg: 0 }, 60, 180)).toBeLessThan(0);
  });
});
