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

/**
 * Whether a `/api/weather` payload carries a reading the tile can actually
 * print. Weather being off answers `null`, which Elysia sends as an empty body
 * and Eden reports as `""` — and any partial payload would render
 * `${Math.round(undefined)}${undefined}`, i.e. "NaN undefined", on a wall
 * display nobody is watching. Render nothing instead.
 */
export function isReadableWeather(data: unknown): data is Weather {
  if (typeof data !== "object" || data === null) return false;
  const { temperature, unit } = data as Partial<Weather>;
  return (
    typeof temperature === "number" && Number.isFinite(temperature) && typeof unit === "string"
  );
}

export type Weather = {
  temperature: number;
  unit: string;
  condition: string;
  icon: string;
  solarRadiationSum: number | null;
  label: string;
  forecast: SolarForecast | null;
};
