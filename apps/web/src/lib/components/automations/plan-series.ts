/**
 * Turns the server's PROJECTION into plottable rows.
 *
 * A projection, deliberately, and nothing else. The measured half of the "Today"
 * view used to live here too — first from the engine's in-memory decision ring,
 * then from the rollups beside it, two implementations of one picture. It is
 * `$lib/history/plant-day` now, next to the shared series reader every other
 * chart uses, and this file has only the thing that has no history to read: what
 * the automation expects to happen for the rest of the day.
 *
 * Two shapes come out of it: the plan's own power decomposition (forecast PV
 * split into load / battery / export / curtailed, which sums back to PV) and the
 * SOC track, where the measured past and the projected future are separate
 * series on one axis so a dashed line can carry "this part hasn't happened yet".
 */

import type { PeakShavingPlan, PlanSlot } from "$lib/automations";
import type { DayRow } from "$lib/history/day-rows";

/**
 * One projected slot as the stacked power chart reads it — the same shape a
 * MEASURED sample takes, which is what lets the two be plotted end to end.
 */
export type PlanRow = DayRow;

/** One point of the SOC track; exactly one of the two values is set per row. */
export type SocRow = {
  t: Date;
  /** Measured SOC, from the plant's own history. */
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
 * "now" carries both values so the two lines meet instead of leaving a gap. The
 * measured half only needs `{t, socPct}`, which is exactly what the plant's
 * rollup series produces.
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
