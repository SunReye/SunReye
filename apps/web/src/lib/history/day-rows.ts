/**
 * WHERE THE PV ACTUALLY WENT — one measured day, decomposed.
 *
 * The plant's own history in the stacked shape the plan chart draws its
 * projection in, so "what was planned" and "what happened" can be plotted on one
 * axis. Pure; `./plant-day.ts` is the read that feeds it.
 *
 * It used to live under `components/automations/` beside a SECOND
 * implementation of the same decomposition that read the automation engine's
 * in-memory decision ring. Two paths to one picture, and the ring's cleared on
 * every restart and only ever held the ticks the automation decided — so the two
 * halves of one chart could disagree about the same day.
 */

import { type MetricSeries, decimate } from "./series";

/** One sample of the measured day, in the plan chart's stacked shape. */
export type DayRow = {
  t: Date;
  loadKw: number;
  chargeKw: number;
  exportKw: number;
  curtailedKw: number;
  /** PV for the slot — the stack's total, shown in the tooltip. */
  pvKw: number;
  thresholdKw: number;
  socPct: number;
};

export interface MeasuredDay {
  /** Where the PV actually went since local midnight, minute-averaged. */
  power: DayRow[];
  /** Measured SOC track over the same window. */
  soc: { t: number; socPct: number }[];
}

const kw = (watts: number) => watts / 1000;

/**
 * Decompose one measured sample.
 *
 * Charge and export are the metered halves (clamped ≥ 0 and capped so the stack
 * can never exceed PV), the house gets the remainder, and nothing is "curtailed"
 * in hindsight — the stack must sum back to the measured PV.
 */
function measuredRow(sample: {
  t: number;
  pvW: number;
  /** Metered battery charge power, W; null when the plant offers none. */
  chargeW: number | null;
  /** Metered grid export power, W; null when the plant offers none. */
  exportW: number | null;
  socPct: number;
}): DayRow {
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
    // No plateau existed for the measured past; the tooltip shows 0.
    thresholdKw: 0,
    socPct: sample.socPct,
  };
}

/**
 * Assemble the measured day from minute-rollup series.
 *
 * An EMPTY series means the plant meters no such metric — distinct from a series
 * of zeros, which is a plant that measured nothing happening. The sign handling
 * (battery/grid negative halves are charge and export) matches the power-flow
 * graph. Decimated to the charts' plot-point ceiling.
 */
export function measuredDaySeries(series: {
  pv: MetricSeries;
  batt: MetricSeries;
  grid: MetricSeries;
  soc: MetricSeries;
}): MeasuredDay {
  const { pv, batt, grid, soc } = series;
  const power = [...pv.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, pvW]) =>
      measuredRow({
        t,
        pvW,
        chargeW: batt.size === 0 ? null : -(batt.get(t) ?? 0),
        exportW: grid.size === 0 ? null : -(grid.get(t) ?? 0),
        socPct: soc.get(t) ?? 0,
      }),
    );
  const socTrack = [...soc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, socPct]) => ({ t, socPct }));
  return { power: decimate(power), soc: decimate(socTrack) };
}
