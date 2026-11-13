// Figures as the range's charts write them, in the SPA's locale.
import { fixedFormat } from "../fixed-format.ts";

export const num = (v: number, digits = 0): string => fixedFormat(digits).format(v);

/** Energy in kWh, or MWh from 10 MWh. */
export function kwh(v: number): string {
  if (Math.abs(v) >= 10_000) return `${num(v / 1000, 1)} MWh`;

  return `${num(v, Math.abs(v) < 100 ? 1 : 0)} kWh`;
}

export const money = (eur: number): string => `${num(eur, Math.abs(eur) < 100 ? 2 : 0)} €`;
