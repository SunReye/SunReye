/**
 * Weather preferences (location for the dashboard tile), cached in memory and
 * invalidated on write. Persisted via the shared `app_settings` accessor.
 */

import { WEATHER_KEY, defaultWeather, weatherConfigSchema } from "@SunReye/db/weather";
import { cachedSetting } from "./app-settings";

const weather = cachedSetting(WEATHER_KEY, weatherConfigSchema, defaultWeather);

export const getWeatherConfig = weather.get;
/**
 * Apply a partial update.
 *
 * A patch rather than a whole-record write because this record is edited from
 * two places: its location half on the Weather page, and the plant it describes
 * — PV surfaces, export limit, battery, smart-meter date — with the inverter,
 * where those things actually live. Each form sends only what it owns, so
 * neither can write back the other's stale values.
 */
export const setWeatherConfig = weather.patch;
