// One hour's values as the weather detail's row headers write them under the pointer (ADR 23
// "Dashboard"): each row's own value, then its second reading's.
import { getLocale } from "../paraglide/runtime.js";
import type { Hour } from "./hourly.ts";

/** Each row's value at an hour, then its second reading's where the row draws one. */
export interface HourFigures {
  readonly temperature: readonly string[];
  readonly precipitation: readonly string[];
  readonly cloud: readonly string[];
  readonly wind: readonly string[];
  readonly humidity: readonly string[];
}

/** What a day draws beside its rows' own readings. */
export interface Drawn {
  /** Its snowfall. */
  readonly snows: boolean;
  /** The clear-sky index. */
  readonly indexed: boolean;
}

/** Written where an hour has no value. */
const NONE = "–";

/** Writes a value to `digits` places before its `unit`. */
function write(digits: number, unit: string) {
  const format = new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  return (value: number | null) => (value === null ? NONE : `${format.format(value)}${unit}`);
}

/** `hour`'s values; the snowfall while the day `snows`, the clear-sky index where it is `indexed`. */
export function hourFigures(hour: Hour, { snows, indexed }: Drawn): HourFigures {
  const [celsius, mm, cm, percent, index, speed] = [
    write(1, " °C"),
    write(1, " mm"),
    write(1, " cm"),
    write(0, " %"),
    write(2, ""),
    write(1, " m/s"),
  ] as const;

  return {
    temperature: [celsius(hour.celsius), celsius(hour.apparent)],
    precipitation: [mm(hour.precipitation), ...(snows ? [cm(hour.snowfall)] : [])],
    cloud: [percent(hour.cloudCover), ...(indexed ? [index(hour.clearSkyIndex)] : [])],
    wind: [speed(hour.wind), speed(hour.gusts)],
    humidity: [percent(hour.humidity)],
  };
}
