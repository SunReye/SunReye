/**
 * Weather preferences (location for the dashboard tile), cached in memory and
 * invalidated on write. Persisted via the shared `app_settings` accessor.
 */

import { WEATHER_KEY, defaultWeather, weatherConfigSchema } from "@SunReye/db/weather";
import { cachedSetting } from "./app-settings";

const weather = cachedSetting(WEATHER_KEY, weatherConfigSchema, defaultWeather);

export const getWeatherConfig = weather.get;
export const setWeatherConfig = weather.set;
