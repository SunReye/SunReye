/**
 * Open-Meteo **archive** (ERA5 reanalysis) irradiance, for the forecast's
 * learned correction. Same keyless upstream as the live provider
 * ({@link ./open-meteo}), but the archive endpoint serves *past* weather over a
 * `start_date … end_date` range at hourly resolution — near-truth, so running it
 * through the PV model yields "what the model would have expected on the real
 * weather", the baseline the correction learns its residual against.
 *
 * Reanalysis settles a few days after the fact, so the caller only ever asks for
 * days old enough to have settled. One request per distinct plane covers the
 * whole range, so a multi-week backfill is a handful of calls.
 */

import type { IrradianceForecast, PlaneOfArray } from "../solar-forecast";
import {
  OPEN_METEO_EXTRA_VARS,
  type OpenMeteoSeries,
  assembleForecast,
  uniquePlanes,
} from "./open-meteo-shared";

interface ArchiveResponse {
  utc_offset_seconds?: number;
  hourly?: OpenMeteoSeries;
}

const BASE = "https://archive-api.open-meteo.com/v1/archive";
const TIMEOUT_MS = 15_000;

async function fetchPlane(
  location: { latitude: number; longitude: number },
  plane: PlaneOfArray,
  startDate: string,
  endDate: string,
  withExtras: boolean,
): Promise<ArchiveResponse> {
  const vars = withExtras
    ? `global_tilted_irradiance_instant,${OPEN_METEO_EXTRA_VARS}`
    : "global_tilted_irradiance_instant";
  const url =
    `${BASE}?latitude=${location.latitude}&longitude=${location.longitude}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&hourly=${vars}&tilt=${plane.tilt}&azimuth=${plane.azimuth}` +
    "&wind_speed_unit=ms&timezone=auto";
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ArchiveResponse;
}

/**
 * Hourly reanalysis irradiance for each plane over `[startDate, endDate]`
 * (inclusive, `YYYY-MM-DD` in the plant's local time), in the same
 * {@link IrradianceForecast} shape the live provider returns — so the PV model
 * in {@link ./solar-forecast} consumes it unchanged.
 */
export async function fetchHistoricalIrradiance(
  location: { latitude: number; longitude: number },
  planes: PlaneOfArray[],
  startDate: string,
  endDate: string,
): Promise<IrradianceForecast> {
  const entries = uniquePlanes(planes);
  const responses = await Promise.all(
    entries.map(([, plane], i) => fetchPlane(location, plane, startDate, endDate, i === 0)),
  );
  return assembleForecast(
    location,
    planes,
    entries,
    responses.map((r) => r.hourly),
    responses[0]?.utc_offset_seconds ?? 0,
  );
}
