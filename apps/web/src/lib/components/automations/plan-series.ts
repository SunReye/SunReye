/**
 * Turns the server's projection into plottable rows.
 *
 * Two shapes come out of it: the plan's own power decomposition (forecast PV
 * split into load / battery / export / curtailed, which sums back to PV) and the
 * SOC track, where the measured past and the projected future are separate
 * series on one axis so a dashed line can carry "this part hasn't happened yet".
 */

import type { DecisionPoint, PeakShavingPlan, PlanSlot } from "$lib/automations";

/** One projected slot as the stacked power chart reads it. */
export type PlanRow = {
  t: Date;
  loadKw: number;
  chargeKw: number;
  exportKw: number;
  curtailedKw: number;
  /** Forecast PV for the slot — the stack's total, shown in the tooltip. */
  pvKw: number;
  thresholdKw: number;
  socPct: number;
};

/** One point of the SOC track; exactly one of the two values is set per row. */
export type SocRow = {
  t: Date;
  /** Measured SOC from the decision log. */
  socPct: number | null;
  /** Projected SOC from the plan. */
  planSocPct: number | null;
};

const kw = (watts: number) => watts / 1000;

export function toPlanRows(slots: PlanSlot[]): PlanRow[] {
  return slots.map((s) => ({
    t: new Date(s.t),
    loadKw: kw(Math.min(s.loadW, s.pvW)),
    chargeKw: kw(s.chargeW),
    exportKw: kw(s.exportW),
    curtailedKw: kw(s.curtailedW),
    pvKw: kw(s.pvW),
    thresholdKw: kw(s.thresholdW),
    socPct: s.socPct,
  }));
}

/** Plot-point ceiling, matching the decision charts' decimation. */
const MAX_POINTS = 720;

/** Every n-th point so at most `MAX_POINTS` remain; the newest always stays. */
function stride<T>(items: T[]): T[] {
  const step = Math.ceil(items.length / MAX_POINTS);
  if (step <= 1) return items;
  const kept = items.filter((_, i) => i % step === 0);
  const last = items.at(-1);
  if (last !== undefined && kept.at(-1) !== last) kept.push(last);
  return kept;
}

/**
 * Assemble the measured "Today" series from minute-rollup maps (epoch ms →
 * value). A null map means the plant meters no such metric; the sign handling
 * (battery/grid negative halves are charge/export) matches the power-flow
 * graph. Decimated to the charts' plot-point ceiling.
 */
export function measuredDaySeries(series: {
  pv: Map<number, number>;
  batt: Map<number, number> | null;
  grid: Map<number, number> | null;
  soc: Map<number, number> | null;
}): { power: PlanRow[]; soc: { t: number; socPct: number }[] } {
  const { pv, batt, grid, soc } = series;
  const power: PlanRow[] = [...pv.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, pvW]) =>
      measuredRow({
        t,
        pvW,
        chargeW: batt ? -(batt.get(t) ?? 0) : null,
        exportW: grid ? -(grid.get(t) ?? 0) : null,
        // No plateau existed for the measured past; the tooltip shows 0.
        thresholdW: 0,
        socPct: soc?.get(t) ?? 0,
      }),
    );
  const socTrack = soc
    ? [...soc.entries()].sort((a, b) => a[0] - b[0]).map(([t, socPct]) => ({ t, socPct }))
    : [];
  return { power: stride(power), soc: stride(socTrack) };
}

/**
 * Decompose one measured sample into the stacked chart's row: where the PV
 * *actually* went. Charge and export are the metered halves (clamped ≥ 0 and
 * capped so the stack can never exceed PV), the house gets the remainder, and
 * nothing is "curtailed" in hindsight — the stack must sum back to the
 * measured PV. The single place this decomposition lives; the decision-ring
 * and rollup paths both feed it.
 */
function measuredRow(sample: {
  t: number;
  pvW: number;
  /** Metered battery charge power, W; null when the plant offers none. */
  chargeW: number | null;
  /** Metered grid export power, W; null when the plant offers none. */
  exportW: number | null;
  thresholdW: number;
  socPct: number;
}): PlanRow {
  const pvW = Math.max(0, sample.pvW);
  const chargeW = Math.min(Math.max(0, sample.chargeW ?? 0), pvW);
  const exportW = Math.min(Math.max(0, sample.exportW ?? 0), pvW - chargeW);
  return {
    t: new Date(sample.t),
    loadKw: kw(pvW - chargeW - exportW),
    chargeKw: kw(chargeW),
    exportKw: kw(exportW),
    curtailedKw: 0,
    pvKw: kw(pvW),
    thresholdKw: kw(sample.thresholdW),
    socPct: sample.socPct,
  };
}

/** The day so far from the decision ring, in the same shape as the plan rows. */
export function toMeasuredRows(points: DecisionPoint[]): PlanRow[] {
  return points.map((p) => measuredRow(p));
}

/** History points since local midnight — the measured half of a "today" view. */
export function todayPoints(points: DecisionPoint[]): DecisionPoint[] {
  const midnight = new Date().setHours(0, 0, 0, 0);
  return points.filter((p) => p.t >= midnight);
}

/**
 * The full-day power track: the measured day so far, then the projection for
 * what's left of it. The projection's running slot starts before "now", so the
 * seam trims plan rows that would overlap the last measured sample.
 */
export function joinDayRows(measured: PlanRow[], plan: PlanRow[]): PlanRow[] {
  const seam = measured.at(-1)?.t.getTime() ?? Number.NEGATIVE_INFINITY;
  return [...measured, ...plan.filter((r) => r.t.getTime() > seam)];
}

/**
 * A slot's end, ms: the next slot's start, or one slot-width past the last one
 * (inferred from the previous gap). Projected SOC is an *end-of-slot* value, so
 * plotting it at the slot start would report every step 15 minutes early.
 */
function slotEnd(slots: PlanSlot[], i: number): number {
  const next = slots[i + 1];
  if (next) return next.t;
  const previous = slots[i - 1];
  const width = previous ? slots[i]!.t - previous.t : 15 * 60_000;
  return slots[i]!.t + width;
}

/**
 * The SOC track: measured history, then the projection. The hand-over row at
 * "now" carries both values so the two lines meet instead of leaving a gap.
 * The measured half only needs `{t, socPct}`, so decision points and rollup
 * samples both fit.
 */
export function toSocRows(
  history: { t: number; socPct: number }[],
  plan: PeakShavingPlan | null,
): SocRow[] {
  const past: SocRow[] = history.map((p) => ({
    t: new Date(p.t),
    socPct: p.socPct,
    planSocPct: null,
  }));
  const slots = plan?.slots ?? [];
  if (slots.length === 0) return past;
  const handOverSoc = history.at(-1)?.socPct ?? slots[0]!.socPct;
  return [
    ...past,
    { t: new Date(slots[0]!.t), socPct: handOverSoc, planSocPct: handOverSoc },
    ...slots.map((s, i) => ({
      t: new Date(slotEnd(slots, i)),
      socPct: null,
      planSocPct: s.socPct,
    })),
  ];
}
