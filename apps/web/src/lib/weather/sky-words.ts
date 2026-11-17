// The sky's words (ADR 23 "Dashboard").
import { m } from "../paraglide/messages.js";
import type { Sky } from "./sky.ts";

export const SKY_WORDS: Readonly<Record<Sky, () => string>> = {
  sunny: m.weather_sky_sunny,
  fair: m.weather_sky_fair,
  cloudy: m.weather_sky_cloudy,
  overcast: m.weather_sky_overcast,
  clear: m.weather_sky_clear,
  fog: m.weather_sky_fog,
  drizzle: m.weather_sky_drizzle,
  rain: m.weather_sky_rain,
  snow: m.weather_sky_snow,
  showers: m.weather_sky_showers,
  thunder: m.weather_sky_thunder,
};
