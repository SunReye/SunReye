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

interface OpenMeteoSeries {
  time?: string[];
  temperature_2m?: (number | null)[];
  // Instantaneous GTI at each timestamp. The non-`_instant` variable is a
  // preceding-interval *mean*, which — sampled onto the step it's stamped at —
  // shifts the curve and over-reports the steep sunset limb; the instantaneous
  // series is integrated per step in buildSolarForecast.
  global_tilted_irradiance_instant?: (number | null)[];
  // Beam component for the model's incidence-angle (IAM) split.
  direct_normal_irradiance_instant?: (number | null)[];
  // For the Faiman cell-temperature model (requested in m/s).
  wind_speed_10m?: (number | null)[];
}

interface OpenMeteoResponse {
  utc_offset_seconds?: number;
  minutely_15?: OpenMeteoSeries;
}

const BASE = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 8000;
const EXTRA_VARS = "direct_normal_irradiance_instant,temperature_2m,wind_speed_10m";

async function fetchPlane(
  location: { latitude: number; longitude: number },
  plane: PlaneOfArray,
  withExtras: boolean,
): Promise<OpenMeteoResponse> {
  const vars = withExtras
    ? `global_tilted_irradiance_instant,${EXTRA_VARS}`
    : "global_tilted_irradiance_instant";
  const url =
    `${BASE}?latitude=${location.latitude}&longitude=${location.longitude}` +
    `&minutely_15=${vars}&tilt=${plane.tilt}&azimuth=${plane.azimuth}` +
    "&wind_speed_unit=ms&timezone=auto&forecast_days=2";
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as OpenMeteoResponse;
}

export const openMeteoIrradiance: SolarIrradianceProvider = {
  id: "open-meteo",

  async fetch(location, planes): Promise<IrradianceForecast> {
    // One request per distinct orientation; planes that share one reuse it.
    const unique = new Map<string, PlaneOfArray>();
    for (const p of planes) unique.set(`${p.tilt}/${p.azimuth}`, p);
    const entries = [...unique.entries()];
    const responses = await Promise.all(
      entries.map(([, plane], i) => fetchPlane(location, plane, i === 0)),
    );

    const first = responses[0]?.minutely_15;
    const times = first?.time;
    if (!times || !first.temperature_2m) throw new Error("missing minutely_15 fields");
    const byKey = new Map(entries.map(([key], i) => [key, responses[i]]));

    return {
      times,
      utcOffsetSeconds: responses[0]?.utc_offset_seconds ?? 0,
      location,
      temperature: first.temperature_2m.map((t) => t ?? 0),
      gti: planes.map((p) => {
        const series = byKey.get(`${p.tilt}/${p.azimuth}`)?.minutely_15
          ?.global_tilted_irradiance_instant;
        if (!series || series.length !== times.length) {
          throw new Error("missing irradiance series");
        }
        return series.map((v) => v ?? 0);
      }),
      // Optional extras: only pass series that line up with `times`, so the
      // model's fallbacks (no IAM split / NOCT temperature) kick in cleanly.
      ...(first.direct_normal_irradiance_instant?.length === times.length && {
        dni: first.direct_normal_irradiance_instant.map((v) => v ?? 0),
      }),
      ...(first.wind_speed_10m?.length === times.length && {
        windSpeed: first.wind_speed_10m.map((v) => v ?? 0),
      }),
    };
  },
};
