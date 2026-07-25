/**
 * Shared plumbing for the Open-Meteo providers ({@link ./open-meteo} live +
 * {@link ./open-meteo-archive} reanalysis). Both endpoints return the same
 * variable names under a different container (`minutely_15` vs `hourly`), so the
 * plane deduplication and the series → {@link IrradianceForecast} assembly are
 * identical — only the request URL and container key differ.
 */

import type { IrradianceForecast, PlaneOfArray } from "../solar-forecast";

/** One time series from either endpoint (same field names in both). */
export interface OpenMeteoSeries {
  time?: string[];
  temperature_2m?: (number | null)[];
  // Instantaneous GTI at each timestamp (the `_instant` variant, not the
  // preceding-interval mean) — integrated per step in buildSolarForecast.
  global_tilted_irradiance_instant?: (number | null)[];
  // Beam component for the model's incidence-angle (IAM) split.
  direct_normal_irradiance_instant?: (number | null)[];
  // For the Faiman cell-temperature model (requested in m/s).
  wind_speed_10m?: (number | null)[];
}

/** Plane-independent extras, requested alongside GTI on the first plane only. */
export const OPEN_METEO_EXTRA_VARS =
  "direct_normal_irradiance_instant,temperature_2m,wind_speed_10m";

/** Distinct orientations, keyed `tilt/azimuth` — identical planes reuse one request. */
export function uniquePlanes(planes: PlaneOfArray[]): [string, PlaneOfArray][] {
  const unique = new Map<string, PlaneOfArray>();
  for (const p of planes) unique.set(`${p.tilt}/${p.azimuth}`, p);
  return [...unique.entries()];
}

/**
 * Assemble the aligned {@link IrradianceForecast} from per-plane series (in the
 * order of `entries`). The first plane's series carries the plane-independent
 * temperature/DNI/wind; each plane maps to its own GTI. Optional extras are only
 * included when they line up with `times`, so the PV model's fallbacks kick in
 * cleanly when a provider omits them.
 */
export function assembleForecast(
  location: { latitude: number; longitude: number },
  planes: PlaneOfArray[],
  entries: [string, PlaneOfArray][],
  seriesByPlane: (OpenMeteoSeries | undefined)[],
  utcOffsetSeconds: number,
): IrradianceForecast {
  const first = seriesByPlane[0];
  const times = first?.time;
  if (!times || !first.temperature_2m) throw new Error("missing series fields");
  const byKey = new Map(entries.map(([key], i) => [key, seriesByPlane[i]]));

  return {
    times,
    utcOffsetSeconds,
    location,
    temperature: first.temperature_2m.map((t) => t ?? 0),
    gti: planes.map((p) => {
      const series = byKey.get(`${p.tilt}/${p.azimuth}`)?.global_tilted_irradiance_instant;
      if (!series || series.length !== times.length) throw new Error("missing irradiance series");
      return series.map((v) => v ?? 0);
    }),
    ...(first.direct_normal_irradiance_instant?.length === times.length && {
      dni: first.direct_normal_irradiance_instant.map((v) => v ?? 0),
    }),
    ...(first.wind_speed_10m?.length === times.length && {
      windSpeed: first.wind_speed_10m.map((v) => v ?? 0),
    }),
  };
}
