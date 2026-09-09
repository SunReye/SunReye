/**
 * Seasonal weighting for the amortisation projection — pure math over the
 * forecast subsystem's sun geometry, no database, no network.
 *
 * A young plant's savings-per-year is `savings / elapsed time`, and the
 * elapsed time carries whatever season the plant has seen: commissioned in
 * May, the first 200 days are summer-heavy and the projection is optimistic;
 * commissioned in October, the reverse. Measuring elapsed time in **solar
 * years** instead of calendar years corrects for it: each day is worth the
 * share of a year's clear-sky plane-of-array irradiation it would collect on
 * THIS roof (latitude, tilt, azimuth, installed power), so 200 days of summer
 * come out at ~0.7 of a year and the savings are spread over that.
 *
 * Clear-sky is a deliberate simplification: it models the geometry (day length,
 * sun height, incidence) and not the climate (winter is also cloudier), so the
 * winter penalty is somewhat UNDERstated and a summer-commissioned plant still
 * reads slightly optimistic — but by a fraction of the error it removes. The
 * clearness of the actual sky is what a year of recorded history will supply.
 */

import type { SeasonalGap } from "@SunReye/contracts/statistics";
import { cosAoi, sunPosition } from "../forecast/solar-geometry";

export interface SeasonalPlane {
  kwp: number;
  tilt: number;
  /** 0 = south, −90 = east, 90 = west (the project's panel convention). */
  azimuth: number;
}

export interface Location {
  latitude: number;
  longitude: number;
}

const DAY_MS = 86_400_000;
const STEP_MIN = 15;
const DEG = Math.PI / 180;
/** Solar constant, W/m². */
const SOLAR_CONSTANT = 1361;
/** Meinel clear-sky beam attenuation per unit air mass (0.7^AM^0.678). */
const CLEAR_SKY_TAU = 0.7;
const CLEAR_SKY_EXP = 0.678;
/** Diffuse fraction of the beam on a clear day, projected on the horizontal. */
const DIFFUSE_RATIO = 0.12;

/** Kasten–Young relative air mass for a sun elevation in degrees (>0). */
function airMass(elevationDeg: number): number {
  return 1 / (Math.sin(elevationDeg * DEG) + 0.50572 * (elevationDeg + 6.07995) ** -1.6364);
}

/** Clear-sky plane-of-array irradiance, W/m², for one instant and one plane. */
function poaW(location: Location, plane: SeasonalPlane, atMs: number): number {
  const sun = sunPosition(location.latitude, location.longitude, atMs);
  if (sun.elevationDeg <= 0) return 0;
  const dni = SOLAR_CONSTANT * CLEAR_SKY_TAU ** (airMass(sun.elevationDeg) ** CLEAR_SKY_EXP);
  const beam = dni * Math.max(0, cosAoi(sun, plane.tilt, plane.azimuth));
  const dhi = DIFFUSE_RATIO * dni * Math.sin(sun.elevationDeg * DEG);
  const diffuse = (dhi * (1 + Math.cos(plane.tilt * DEG))) / 2;
  return beam + diffuse;
}

/**
 * The clear-sky energy this roof would collect on one UTC day, in kWh (kWp ×
 * kWh/m² over the day, an arbitrary but consistent unit — only ratios of it
 * are used). Zero through polar night.
 */
// fallow-ignore-next-line unused-export -- the unit the seasonal-weight.test.ts invariants are stated in; test files aren't traced as consumers
export function clearSkyDayWeight(
  location: Location,
  planes: readonly SeasonalPlane[],
  dayStartUtc: Date,
): number {
  const start = dayStartUtc.getTime();
  let wh = 0;
  for (let minute = 0; minute < 1440; minute += STEP_MIN) {
    const at = start + minute * 60_000;
    for (const plane of planes) wh += plane.kwp * poaW(location, plane, at) * (STEP_MIN / 60);
  }
  return wh / 1000;
}

/** Midnight UTC of the day containing `t`. */
const utcDayStart = (t: Date): number => Math.floor(t.getTime() / DAY_MS) * DAY_MS;

/**
 * Elapsed time between `from` and `to` measured in solar years for this roof:
 * the sum of the window's daily weights over the weight of one whole year.
 * Days are whole UTC days from the day `from` falls on; the reference year is
 * the one `from` falls in (a leap day shifts it by a fraction of a percent).
 */
export function solarYears(
  location: Location,
  planes: readonly SeasonalPlane[],
  from: Date,
  to: Date,
): number {
  const first = utcDayStart(from);
  const last = utcDayStart(to);
  if (last <= first || planes.length === 0) return 0;

  // Weights repeat with the calendar, so one pass over the reference year
  // serves every day of every year in the window — keyed by day of year.
  const year = new Date(first).getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year + 1, 0, 1);
  const byDayOfYear: number[] = [];
  let yearTotal = 0;
  for (let d = yearStart; d < yearEnd; d += DAY_MS) {
    const w = clearSkyDayWeight(location, planes, new Date(d));
    byDayOfYear.push(w);
    yearTotal += w;
  }
  if (yearTotal === 0) return (last - first) / (365.25 * DAY_MS);

  let sum = 0;
  for (let d = first; d < last; d += DAY_MS) {
    const dt = new Date(d);
    const doy = Math.floor((d - Date.UTC(dt.getUTCFullYear(), 0, 1)) / DAY_MS);
    sum += byDayOfYear[Math.min(doy, byDayOfYear.length - 1)] ?? 0;
  }
  return sum / yearTotal;
}

/** The slice of the weather config the weighting depends on. */
export interface RoofConfig {
  enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  forecast: { arrays: readonly SeasonalPlane[] };
}

/**
 * What stands between this plant and seasonal weighting, in the order the
 * settings page fixes them. Empty means the roof is known and the weighting is
 * on. Every gap is reported at once — a reader who has to fix them one by one,
 * reloading between, would give up.
 */
export function seasonalGaps(config: RoofConfig): SeasonalGap[] {
  const gaps: SeasonalGap[] = [];
  if (!config.enabled) gaps.push("weather");
  if (config.latitude === null || config.longitude === null) gaps.push("location");
  if (config.forecast.arrays.length === 0) gaps.push("arrays");
  return gaps;
}
