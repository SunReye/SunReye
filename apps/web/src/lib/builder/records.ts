// What the builder reads of Home's core (ADR 25 "What the frame reads of its host"): each saved
// string's stored series, the stored weather, the model check's corrections and the uploaded car
// bodies. Pure but for the reads it is handed.
import type { Records } from "@sunreye/builder";
import { only, type Core } from "../api/core.ts";
import { modelLoader } from "../cars/models.ts";
import { readWeather, weatherAt } from "../weather/weather.ts";

/** A forecast's step. */
const STEP = 15 * 60_000;

/** What the builder reads of `core`; a read it lacks, the builder goes without. */
export function homeRecords(
  core: Pick<Core, "history" | "forecasts"> & Partial<Pick<Core, "corrections" | "carBody">>,
): Records {
  const { corrections, carBody } = core;

  return {
    production: async ({ id, device }, source, [from, to]) => {
      const series = `pv.string.power[${String(id)}]`;

      if (source === "measured") {
        const history = only(await core.history(device, [series], from, to));

        return "problem" in history
          ? []
          : history.points.map(
              ({ start, end, mean }: Readonly<{ start: string; end: string; mean: number }>) => ({
                from: Date.parse(start),
                to: Date.parse(end),
                watts: mean,
              }),
            );
      }

      const forecasts = only(await core.forecasts(device, [series], from, to));

      return "problem" in forecasts
        ? []
        : forecasts.points.map(({ target, value }: Readonly<{ target: string; value: number }>) => {
            const at = Date.parse(target);

            return { from: at, to: at + STEP, watts: value };
          });
    },
    weather: async ([from, to]) => {
      const read = await readWeather(core, from, to);

      return (at, asOf) => weatherAt(read, at, asOf);
    },
    ...(corrections && { corrections: () => corrections.call(core) }),
    ...(carBody && { model: modelLoader({ carBody: (id) => carBody.call(core, id) }) }),
  };
}
