// Shapes of the /api/weather payload, shared by the weather tile and the pieces
// it composes.

/** Provider-agnostic solar forecast (see apps/server/src/solar-forecast.ts). */
export type SolarForecast = {
  provider: string;
  /** Slot width of `series` in minutes (15 for Open-Meteo). */
  stepMinutes: number;
  /** Expected avg/peak AC power per slot, plant-local (`YYYY-MM-DDTHH:mm`). */
  series: { time: string; watts: number; peakWatts: number }[];
  /** Uncurtailed PV potential over the same slots; equals `series` when nothing clips. */
  raw?: { series: { time: string; watts: number; peakWatts: number }[] };
  todayKwh: number;
  remainingTodayKwh: number;
  tomorrowKwh: number;
  next15: { maxPowerW: number; energyKwh: number };
};

export type Weather = {
  temperature: number;
  unit: string;
  condition: string;
  icon: string;
  solarRadiationSum: number | null;
  label: string;
  forecast: SolarForecast | null;
};
