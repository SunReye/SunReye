/**
 * HOW A ROLE FOLDS ACROSS A PLANT'S DEVICES.
 *
 * Storage is per device. A plant with two inverters therefore has two
 * `pv.total.power` series, and "the plant's PV power" is a rule, not a row.
 * That rule is a property of the ROLE — the closed vocabulary of
 * `./roles.ts` — never a guess from a metric key, so that every reader (the
 * rollup fold, the raw fold, the live fold) applies the same one.
 *
 *  - `sum`: power and energy add up across machines.
 *  - `weighted-mean`: a fraction or a temperature is averaged, weighted by the
 *    member's battery capacity (`plantMembers` in the server), so a 10 kWh
 *    pack at 100 % and a 5 kWh pack at 40 % read 80 %, not 70 %.
 *  - `per-device`: the electrical state of one machine — a voltage, a
 *    frequency, a phase, a string, a status word, a setting — has no plant
 *    value. A plant-level read of one is REFUSED, never rendered as an empty
 *    series a chart would draw as flat zero.
 *
 * Each spec states its own `aggregate`. `per-device` is the answer for a role
 * the catalogue does not know, because it is the one answer that cannot invent
 * a total.
 */

import { type CanonicalRole, ROLE_CATALOG, type RoleSpec } from "./roles";

export const PLANT_AGGREGATES = ["sum", "weighted-mean", "per-device"] as const;
export type PlantAggregate = (typeof PLANT_AGGREGATES)[number];

/**
 * The aggregate for a role. `spec` is taken from {@link ROLE_CATALOG} when the
 * role is canonical; an unknown or absent role is `per-device`.
 */
export function plantAggregateOf(
  role: string | undefined,
  spec: RoleSpec | undefined = role !== undefined && role in ROLE_CATALOG
    ? ROLE_CATALOG[role as CanonicalRole]
    : undefined,
): PlantAggregate {
  if (spec === undefined) return "per-device";
  return spec.aggregate;
}
