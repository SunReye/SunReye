// The PV forecast sheet's read (ADR 21 "Details by drilling down"): the plant's forecast from the
// judged days before today to the end of the day after tomorrow, each string's or MPPT input's
// over the three days, the plant's measured days and the sky (ADR 17 "Storage", ADR 23).
import { PLANT, type Core, type PvString } from "../api/core.ts";
import type { Target } from "../dashboard/today.ts";
import { readForecast } from "../history/forecast.ts";
import { rollups, type Rolled } from "../history/history.ts";
import { layoutStrings } from "../live/plant-facts.ts";
import { daySpans, hourly, type WeatherDay } from "../weather/hourly.ts";
import { readWeatherSources } from "../weather/weather.ts";
import { trackFrom, type AheadLine, type AheadRead } from "./ahead.ts";
import { inputLines, stringLines, type Wanted } from "./ahead-lines.ts";
import { AHEAD, held, planned } from "./forecast.ts";

export type AheadReader = Readonly<Pick<Core, "layout" | "forecasts" | "statistics" | "history">>;

const HOUR = 3_600_000;

/** Of the weather, the sheet shows the sky and the sunshine alone. */
const SKY = ["weather.code", "weather.ghi", "weather.sunshine"] as const;

export interface Ahead {
  /** When it was read, ms since 1970: what was measured is as of then. */
  readonly asOf: number;
  /** Today and the days after it, each [start, end) in ms since 1970. */
  readonly spans: readonly (readonly [number, number])[];
  /** The plant's forecast targets, which the day curves draw. */
  readonly targets: readonly Target[];
  readonly read: AheadRead;
  /** Whether the lines are MPPT inputs: the plant has no forecast of its strings. */
  readonly inputs: boolean;
  /** The plant's `pv.power` day rollups, from the first judged day to now. */
  readonly measured: readonly Rolled[];
  readonly weather: readonly WeatherDay[];
}

function lines(
  core: AheadReader,
  wanted: readonly Wanted[],
  from: Readonly<Date>,
  to: Readonly<Date>,
) {
  return Promise.all(
    wanted.map(async ({ device, series, label, colour }): Promise<AheadLine> => ({
      label,
      colour,
      planned: await planned(core, device, series, from, to),
    })),
  );
}

/**
 * The sheet's read for the day that starts at `start`, a plant midnight in `zone`, as of `now`;
 * null for a plant without a layout.
 */
export async function readAhead(
  core: AheadReader,
  zone: string,
  start: Readonly<Date>,
  now: Readonly<Date>,
): Promise<Ahead | null> {
  const strings: readonly Readonly<PvString>[] = await layoutStrings(core);

  if (strings.length === 0) return null;

  const spans = daySpans(zone, start, AHEAD + 1);
  const [from, to] = [new Date(start.getTime()), new Date(spans.at(-1)?.[1] ?? start.getTime())];
  const past = trackFrom(zone, now.getTime());
  const inverters = [...new Set(strings.map((s) => s.device))];
  // History to the close of the hour in progress, as the weather detail's.
  const measuredTo = new Date((Math.floor(now.getTime() / HOUR) + 1) * HOUR);

  const [targets, byString, measured, sky] = await Promise.all([
    readForecast(core, inverters, past.getTime(), to.getTime()),
    lines(core, stringLines(strings), from, to),
    rollups(core, PLANT, "pv.power", "day", past, new Date(now.getTime())),
    readWeatherSources(core, from, to, measuredTo, SKY),
  ]);

  // A core that forecasts no strings still forecasts their inputs (ADR 17).
  const inputs = byString.every((line) => line.planned.length === 0);

  return {
    asOf: now.getTime(),
    spans,
    targets,
    read: {
      plant: held(targets),
      lines: inputs ? await lines(core, inputLines(strings), from, to) : byString,
    },
    inputs,
    measured,
    weather: hourly(sky, zone, start),
  };
}
