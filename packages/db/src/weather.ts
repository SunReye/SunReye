/**
 * Weather preferences — the location the dashboard's weather tile renders for.
 * Stored in `app_settings` under {@link WEATHER_KEY} and validated with
 * {@link weatherConfigSchema} on read/write, mirroring the display/access
 * config pattern. Data comes from Open-Meteo (keyless), proxied by the server.
 */

import { z } from "zod";

/** `app_settings.key` under which the weather config is stored. */
export const WEATHER_KEY = "weather";

/**
 * One PV array (a group of panels sharing an orientation). Plants with strings
 * facing different directions add one entry per orientation.
 */
const pvArraySchema = z.object({
  /** Peak DC power of this array in kWp. */
  kwp: z.number().positive().max(100_000),
  /** Panel tilt from horizontal in degrees (0 = flat, 90 = vertical). */
  tilt: z.number().min(0).max(90),
  /**
   * Panel azimuth in degrees, Open-Meteo/PV convention:
   * 0 = south, -90 = east, 90 = west, ±180 = north.
   */
  azimuth: z.number().min(-180).max(180),
});

/**
 * Battery parameters for the forecast's clipping model. Present only when the
 * plant has storage the forecast should account for; `usableKwh` drives how
 * much above-cap surplus the battery can soak up before the rest is curtailed.
 */
const forecastBatterySchema = z.object({
  /** Usable (not nominal) battery energy in kWh — the DoD-limited window. */
  usableKwh: z.number().positive().max(10_000),
  /**
   * Max charge power in W, or `null` for "unbounded within the hour" (the daily
   * kWh total is dominated by total headroom vs surplus, not the intra-hour
   * rate, so `null` is a fine default).
   */
  maxChargeW: z.number().positive().max(10_000_000).nullable().default(null),
  /** Reserve floor in % the battery is not discharged below (overnight drain). */
  minSoc: z.number().min(0).max(100).default(10),
  /**
   * Nominal pack voltage in V — what the peak-shaving engine converts watts to
   * charge-current amps with when no `battery.voltage` metric is mapped.
   *
   * `null`, not a default, so "never stated" stays distinguishable from "stated
   * as 51.2". A plant that predates this field keeps whatever it set on the
   * automations page, which is where this used to live; the engine falls back to
   * that value while this is null (see peak-shaving-engine's `liveBatteryV`).
   * Getting it wrong is not cosmetic — every commanded current is scaled by it,
   * so a 48 V pack driven at 51.2 V is charged 7 % below what was asked for.
   */
  nominalV: z.number().positive().max(1_500).nullable().default(null),
});

/**
 * Learned bias-correction ("site adaptation") settings. The correction *learns*
 * in the background whenever the forecast is configured; this flag only gates
 * whether the learned multiplier is *applied* to the live forecast — so the
 * operator can inspect the learned factors and measured skill before trusting
 * them. The learning math (half-life, clamp, shrinkage) is not user-tunable.
 */
const forecastCorrectionConfigSchema = z.object({
  /** Apply the learned correction to the forecast (off = learn but don't apply). */
  enabled: z.boolean().default(false),
});

/**
 * Production-forecast settings for the plant (provider-agnostic PV model).
 *
 * Reached in production through {@link weatherConfigSchema}; exported only so
 * `apps/server/src/forecast/solar-forecast.test.ts` can build a forecast config directly.
 *
 * @internal
 */
export const solarForecastConfigSchema = z.object({
  /** Enable the production forecast on the weather tile. */
  enabled: z.boolean().default(false),
  /** Irradiance data source; must match a provider registered in the server. */
  provider: z.string().default("open-meteo"),
  arrays: z.array(pvArraySchema).max(8).default([]),
  /**
   * Power temperature coefficient of Pmax in %/°C (from the panel datasheet,
   * negative — output drops as cells heat up). Typical mono-Si: -0.30 … -0.45.
   */
  tempCoefficient: z.number().min(-2).max(0).default(-0.4),
  /**
   * Static system losses in % (inverter conversion, wiring, soiling, mismatch).
   * PVWatts' default assumption is 14.
   */
  systemLoss: z.number().min(0).max(90).default(14),
  /**
   * Max power the plant can feed to the grid in W (the inverter's "solar sell" /
   * feed-in cap), or `null` to model no export limit. Once the battery is full,
   * PV beyond `load + this` has nowhere to go and is curtailed — the correction
   * that stops the forecast overstating output on bright, full-battery hours.
   */
  maxOutputW: z.number().positive().max(10_000_000).nullable().default(null),
  /** Battery storage for the clipping model, or `null` for no buffer. */
  battery: forecastBatterySchema.nullable().default(null),
  /**
   * Average house load in W used by the clipping model (PV serves load before
   * it can be curtailed). `null` means infer it from recent history.
   */
  houseLoadW: z.number().min(0).max(10_000_000).nullable().default(null),
  /**
   * Date a smart meter gateway (iMSys) was installed, `YYYY-MM-DD`, or null.
   *
   * A plant fact, not an automation knob, which is why it lives here beside the
   * export limit it is bound up with: installing one is what lifts the 60 %
   * Wirkleistungsbegrenzung to 100 %, and it marks the plant as belonging to the
   * cohort §51 EEG applies to. Price-aware automation is gated on it — that is
   * the whole "only for people who got the gateway" condition, expressed as
   * something true about the plant rather than a second switch.
   */
  smartMeterSince: z.string().nullable().default(null),
  /** Learned bias-correction; learns in the background, applied only when enabled. */
  correction: forecastCorrectionConfigSchema.default(forecastCorrectionConfigSchema.parse({})),
});

export const weatherConfigSchema = z.object({
  /** Enable the weather tile + Open-Meteo fetch. Off until a location is set. */
  enabled: z.boolean().default(false),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  /** Friendly place name shown on the tile (e.g. "Limburg-Weilburg"). */
  label: z.string().max(120).default(""),
  forecast: solarForecastConfigSchema.default(solarForecastConfigSchema.parse({})),
});
export type WeatherConfig = z.infer<typeof weatherConfigSchema>;

export const defaultWeather: WeatherConfig = weatherConfigSchema.parse({});

/** Whether the config has everything needed to fetch (enabled + coordinates). */
export function weatherReady(c: WeatherConfig): c is WeatherConfig & {
  latitude: number;
  longitude: number;
} {
  return c.enabled && c.latitude !== null && c.longitude !== null;
}

/** Whether the production forecast should run (weather on + arrays configured). */
export function forecastReady(c: WeatherConfig): c is WeatherConfig & {
  latitude: number;
  longitude: number;
} {
  return weatherReady(c) && c.forecast.enabled && c.forecast.arrays.length > 0;
}
