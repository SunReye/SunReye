// The house sheet's consumers: each measured point's own consumption (ADR 14, 21).
import type { Topology } from "../api/setup.ts";
import { m } from "../paraglide/messages.js";
import { kept, type Group, type Reader } from "./rows.ts";

const KW = { unit: "kW", digits: 2, scale: 0.001 };

/** A measurement point of the plant's topology (ADR 14). */
export type MeasurementPoint = Readonly<Omit<Topology["points"][number], "claims">> & {
  readonly claims: readonly Readonly<Topology["points"][number]["claims"][number]>[];
};

/**
 * Each measured point's own consumption from the plant's `point.power` (ADR 14), the loadpoint's
 * opening its sheet; last, the root's own, which no point explains, once another point is read.
 */
export function consumers(plant: Reader, points: readonly MeasurementPoint[]): Group {
  const row = (p: MeasurementPoint, label: string) => {
    const charger = p.claims.find((c) => c.role === "ev.charge.power");

    return plant.num(`point.power[${p.id}]`, {
      label,
      ...KW,
      ...(charger && { to: `ev-${charger.device}` }),
    });
  };

  const measured = kept(points.flatMap((p) => (p.parent === null ? [] : [row(p, p.name)])));
  const root = points.find((p) => p.parent === null);

  return {
    title: m.rd_consumers(),
    rows:
      measured.length === 0 || root === undefined
        ? []
        : [...measured, ...kept([row(root, m.rd_unmeasured())])],
  };
}
