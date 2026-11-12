// What the dashboard says of now (ADR 21). Pure.
import type { Target } from "./today.ts";

/** Below this the PV counts as idle: an inverter's standby draw, not production. */
const IDLE_WATTS = 50;

export interface Headline {
  readonly subject: "production" | "consumption";
  /** Null before the first reading. */
  readonly watts: number | null;
}

/** PV power while PV produces, house consumption while it is idle, from the `plant` device. */
export function headline(plant?: Readonly<Record<string, number>>): Headline {
  if (plant === undefined) return { subject: "production", watts: null };

  const pv = plant["pv.power"] ?? 0;

  return pv > IDLE_WATTS
    ? { subject: "production", watts: pv }
    : { subject: "consumption", watts: plant["load.power"] ?? null };
}

export type PriceLevel = "cheap" | "normal" | "dear";

/** Where `price` sits among the day's prices: its lowest third, its highest, or between. */
export function priceLevel(price: number, day: readonly number[]): PriceLevel | null {
  if (day.length === 0) return null;

  const sorted = day.toSorted((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length / 3)] ?? price;
  const high = sorted[Math.ceil((sorted.length * 2) / 3) - 1] ?? price;

  if (price < low) return "cheap";

  return price > high ? "dear" : "normal";
}

export type Sky = "sunny" | "partly" | "cloudy" | "night";

/** The sky from global and diffuse irradiance in W/m²: the more diffuse, the more cloud. */
export function sky({ ghi, dhi }: { readonly ghi: number; readonly dhi: number }): Sky {
  if (ghi < 1) return "night";

  const diffuse = dhi / ghi;

  if (diffuse >= 0.8) return "cloudy";

  return diffuse >= 0.45 ? "partly" : "sunny";
}

/** The value of the target that began last at `now`; null before the first. */
export function current(targets: readonly Target[], now: Readonly<Date>): number | null {
  const begun = targets.filter((t) => Date.parse(t.target) <= now.getTime());

  return begun.at(-1)?.value ?? null;
}
