// The time slider's day (ADR 20): where each string's production comes from, and its value at an
// instant. Pure but for the reads it is handed; nothing here touches the scene.
import { only, type Core, type ModuleType } from "../api/core.ts";
import type { Draft } from "@sunreye/builder/builder/modules.ts";
import type { Location, Pv } from "@sunreye/builder/builder/pv.ts";
import type { Neighbour } from "@sunreye/builder/builder/pv.ts";

/** Measured or estimated history, the solar forecast, or a clear sky run in the browser. */
export type Source = "measured" | "forecast" | "clearSky";

/** Watts from `from` to before `to`, in ms since 1970. */
export interface Interval {
  readonly from: number;
  readonly to: number;
  readonly watts: number;
}

/** A day's production, by string position in the draft. */
export interface Day {
  readonly source: Source;
  readonly strings: readonly (readonly Interval[])[];
}

/** The forecast covers today and two more days (ADR 17). */
const FORECAST_DAYS = 2;

const MINUTE = 60_000;

/** The solar forecast's and the clear sky's step. */
const STEP = 15 * MINUTE;

/** `YYYY-MM-DD`, `days` after `day`. */
function after(day: string, days: number): string {
  const date = new Date(`${day}T00:00Z`);

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

/** Where a day's production comes from, seen from `today`; both `YYYY-MM-DD`. */
export function sourceOf(day: string, today: string): Source {
  if (day < today) return "measured";

  return day <= after(today, FORECAST_DAYS) ? "forecast" : "clearSky";
}

/** The watts in force at `at`, or null outside every interval. */
export function wattsAt(intervals: readonly Interval[], at: number): number | null {
  return intervals.find(({ from, to }) => from <= at && at < to)?.watts ?? null;
}

/**
 * The measured PV power at `at` as a share of the strings' peak; null for a forecast or a clear
 * sky, and without a value: only a reading tells what the modules made.
 */
export function shareAt(
  day: Day | undefined,
  strings: Draft["strings"],
  moduleTypes: readonly Readonly<Pick<ModuleType, "id" | "pmax">>[],
  at: number,
): number | null {
  if (day?.source !== "measured") return null;

  const read = day.strings.flatMap((intervals) => wattsAt(intervals, at) ?? []);

  const peak = strings.reduce(
    (sum, { modules, moduleType }) =>
      sum + modules * (moduleTypes.find(({ id }) => id === moduleType)?.pmax ?? 0),
    0,
  );

  return read.length === 0 || peak <= 0 ? null : read.reduce((sum, watts) => sum + watts, 0) / peak;
}

/** What a day is read from and run with. */
export interface Reading {
  readonly core: Pick<Core, "history" | "forecasts">;
  readonly pv: Pv;
  readonly draft: Draft;
  readonly moduleTypes: readonly Readonly<ModuleType>[];
  /** Unknown to a viewer: then a clear sky shows nothing. */
  readonly location: Location | undefined;
  /** The builder's consumer's: a clear sky is shaded by them as by the scene's obstacles. */
  readonly neighbours?: readonly Neighbour[];
  /** `YYYY-MM-DD` in the browser's calendar. */
  readonly day: string;
  readonly today: string;
}

/** The day `YYYY-MM-DD` in the browser's calendar: its midnight and the next. */
export function spanOf(day: string): readonly [Date, Date] {
  return [new Date(`${day}T00:00`), new Date(`${after(day, 1)}T00:00`)];
}

/** Each saved string's stored series for the day; an unsaved one has none. */
function stored(
  reading: Reading,
  source: "measured" | "forecast",
): Promise<(readonly Interval[])[]> {
  const { core, draft, day } = reading;
  const [from, to] = spanOf(day);

  return Promise.all(
    draft.strings.map(async ({ id, device }) => {
      if (id === null || id === undefined) return [];

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
    }),
  );
}

/** Every string under a clear sky through the day, in 15-minute steps. */
function clearSky({ pv, draft, moduleTypes, location, neighbours, day }: Reading): Interval[][] {
  if (location === undefined) return draft.strings.map(() => []);

  const start = new Date(`${day}T00:00`).getTime();
  const end = new Date(`${after(day, 1)}T00:00`).getTime();

  const starts = Array.from(
    { length: Math.round((end - start) / STEP) },
    (_, i) => start + i * STEP,
  );

  const watts = pv.clearSky({
    location,
    scene: draft.scene,
    neighbours: neighbours ?? [],
    moduleTypes,
    strings: draft.strings,
    times: starts.map((at) => Math.floor(at / 1000)),
  });

  return draft.strings.map((_, string) =>
    starts.map((from, i) => ({ from, to: from + STEP, watts: watts[i]?.[string] ?? 0 })),
  );
}

/** The day's production: stored where the slider's day has it, else a clear sky. */
export async function load(reading: Reading): Promise<Day> {
  const source = sourceOf(reading.day, reading.today);

  if (source !== "clearSky") {
    const strings = await stored(reading, source);

    // A day before the first reading shows what the plant would have made.
    if (strings.some((intervals) => intervals.length > 0)) return { source, strings };
  }

  return { source: "clearSky", strings: clearSky(reading) };
}
