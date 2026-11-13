// How the SPA writes every power (ADR 21): whole watts below 1 kW, kilowatts to a tenth from it,
// in the SPA's locale.
import { getLocale } from "./paraglide/runtime.js";

export type PowerUnit = "W" | "kW";

/** One formatter per locale and digits: building one costs far more than formatting with it. */
const FORMATS = new Map<string, Intl.NumberFormat>();

function nf(digits: number): Intl.NumberFormat {
  const key = `${getLocale()} ${digits}`;
  let format = FORMATS.get(key);

  if (!format) {
    format = new Intl.NumberFormat(getLocale(), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      // Never "-0 W".
      signDisplay: "negative",
    });
    FORMATS.set(key, format);
  }

  return format;
}

/** The unit `watts` reads in: kW once it rounds to 1 000 W. */
export const powerUnit = (watts: number): PowerUnit =>
  Math.round(Math.abs(watts)) < 1000 ? "W" : "kW";

/** `watts` as a number in its unit, without the unit. */
export function powerNumber(watts: number): string {
  return powerUnit(watts) === "W" ? nf(0).format(watts) : nf(1).format(watts / 1000);
}

/** `watts` with its unit, e.g. "10 W" or "1,0 kW". */
export const formatPower = (watts: number): string => `${powerNumber(watts)} ${powerUnit(watts)}`;

/** Whether a reading in `unit`, a role unit (ADR 4), is a power: it then reads in this format. */
export const isPower = (unit: string): boolean => unit === "W";
