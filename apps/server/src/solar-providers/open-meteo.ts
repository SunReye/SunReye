/**
 * Open-Meteo irradiance provider for the solar production forecast. Keyless
 * and self-host friendly, like the weather proxy. Open-Meteo computes global
 * tilted irradiance (GTI) server-side, but only for one plane per request —
 * so each distinct panel orientation costs one call; identical orientations
 * are deduplicated. The plane-independent extras (temperature, direct-normal
 * irradiance, wind) ride along on the first request.
 *
 * The series is requested at 15-minute resolution (`minutely_15`): natively
 * modelled in central Europe / North America and interpolated from the hourly
 * model elsewhere, so it is available for any location and lets the forecast
 * chart resolve cloud edges the hourly series smears.
 */

import type { IrradianceForecast, PlaneOfArray, SolarIrradianceProvider } from "../solar-forecast";
import {
  type OpenMeteoSeries,
  assembleForecast,
  fetchOpenMeteo,
  planeVars,
  uniquePlanes,
} from "./open-meteo-shared";

interface OpenMeteoResponse {
  utc_offset_seconds?: number;
  minutely_15?: OpenMeteoSeries;
}

const BASE = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 8000;

async function fetchPlane(
  location: { latitude: number; longitude: number },
  plane: PlaneOfArray,
  withExtras: boolean,
): Promise<OpenMeteoResponse> {
  const url =
    `${BASE}?latitude=${location.latitude}&longitude=${location.longitude}` +
    `&minutely_15=${planeVars(withExtras)}&tilt=${plane.tilt}&azimuth=${plane.azimuth}` +
    "&wind_speed_unit=ms&timezone=auto&forecast_days=2";
  return fetchOpenMeteo<OpenMeteoResponse>(url, TIMEOUT_MS);
}

export const openMeteoIrradiance: SolarIrradianceProvider = {
  id: "open-meteo",

  async fetch(location, planes): Promise<IrradianceForecast> {
    const entries = uniquePlanes(planes);
    const responses = await Promise.all(
      entries.map(([, plane], i) => fetchPlane(location, plane, i === 0)),
    );
    return assembleForecast(
      location,
      planes,
      entries,
      responses.map((r) => r.minutely_15),
      responses[0]?.utc_offset_seconds ?? 0,
    );
  },
};
