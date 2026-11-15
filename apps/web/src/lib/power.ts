// How the SPA writes every power (ADR 21): whole watts below 1 kW, kilowatts to a tenth from it,
// in the SPA's locale.
import { fixedFormat } from "./fixed-format.ts";

export type PowerUnit = "W" | "kW";

// Never "-0 W".
const nf = (digits: number) => fixedFormat(digits, "negative");

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
