/**
 * The optimizer's decisions, as plottable rows — read from the SAME place every
 * other chart in the app reads from.
 *
 * WHAT THIS REPLACED
 *
 * A builder over `DecisionPoint[]`: a bespoke wire type, pushed over a bespoke
 * WebSocket topic, backing a 2 880-slot in-memory ring on the server. It carried
 * the plant's own measurements alongside the decision because it was the only
 * thing a chart could read, it was empty for the first 30 seconds after every
 * restart and forever after a deploy, and it had its own decimation because a
 * 24-hour ring is 2 880 points.
 *
 * Now the optimizer is a device, its decisions are rows in `metrics_raw` under
 * the slug `optimizer`, and this asks `/api/history/rollup` for them exactly as
 * the inverter card asks for PV power. The minute tier does the decimation the
 * stride used to do, and does it on the server.
 *
 * WHY A ROW IS ASSEMBLED FROM TWO DEVICES
 *
 * A decision chart plots what the optimizer DECIDED against what the plant
 * actually DID, and those are two different devices' readings. Both series are
 * bucketed to the minute tier, so they share timestamps and the join is a lookup
 * — which is the whole reason `$lib/history/device-series` exists.
 *
 * PURE, and that is why the fetching lives in `./decision-fetch.ts`. The store
 * that resolves a role to a metric key reaches the socket, and the socket
 * reaches `$app/environment`, which does not exist under `bun test` — so a
 * builder that imported it could not be unit-tested at all. See
 * `apps/web/TESTING.md`.
 */

import { type MetricSeries, decimate, seriesTimestamps } from "$lib/history/series";

// A type alias, not an interface: the chart takes any `ChartRow` (timestamp plus
// series-keyed values), and only aliases get the implicit index signature.
/** One plotted sample: powers in kW, currents in A, time as a `Date`. */
export type DecisionRow = {
  t: Date;
  pvKw: number;
  loadKw: number;
  /** Export the decision implies: PV minus local sinks minus planned charging. */
  exportKw: number;
  /** Charging the decision asks for — the target read back as power. */
  batteryKw: number;
  /** The shave threshold in force, i.e. the plateau the export is held at. */
  thresholdKw: number;
  /** The ceiling the automation decided on. */
  targetA: number;
  /** What the automation last WROTE to the register; null before its first write. */
  registerA: number | null;
  /** Measured export, tooltip only; null when `grid.power` is unmapped. */
  measuredExportKw: number | null;
  /** Measured charging, tooltip only; null when `battery.power` is unmapped. */
  measuredChargeKw: number | null;
  /** True when this tick only simulated. */
  shadow: boolean;
};

/** Selectable plot windows, newest-anchored. */
export const DECISION_WINDOWS = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
} as const;

export type DecisionWindow = keyof typeof DECISION_WINDOWS;

/**
 * The run states, as the integers the server stores under `optimizer.state`.
 *
 * FROZEN BY POSITION, and the same list `apps/server/src/automation/
 * optimizer-device.ts` writes by. A rollup returns the time-weighted MEAN of a
 * bucket, so a minute holding one shadow tick and one active tick averages to
 * something between them — which is why the only question asked of it here is
 * "was any of this bucket shadow", never "which state exactly".
 */
const RUN_STATES = [
  "disabled",
  "blocked",
  "idle",
  "active",
  "shadow",
  "simulating",
  "stale",
] as const;

const SHADOW_STATE = RUN_STATES.indexOf("shadow");
const SIMULATING_STATE = RUN_STATES.indexOf("simulating");

/** The series one row is assembled from — the optimizer's, plus the plant's. */
export type DecisionSeries = {
  targetA: MetricSeries;
  appliedA: MetricSeries;
  thresholdW: MetricSeries;
  localSinkW: MetricSeries;
  state: MetricSeries;
  pvW: MetricSeries;
  loadW: MetricSeries;
  batteryV: MetricSeries;
  batteryW: MetricSeries;
  gridW: MetricSeries;
};

const kw = (watts: number) => watts / 1000;

/** The value at `t`, or null when this bucket carries no reading. */
const at = (one: MetricSeries, t: number): number | null => one.get(t) ?? null;

/**
 * The value at `t` as a number, treating an absent reading as zero.
 *
 * Only for the series a chart draws on the power plane, where "nothing was
 * reported" and "nothing was happening" plot identically. Never for the
 * tooltip's metered halves, which say `null` and mean it.
 */
const num = (one: MetricSeries, t: number): number => one.get(t) ?? 0;

/**
 * The NEGATIVE half of a signed plant reading, in kW — null when unmetered.
 *
 * Sign conventions follow the power-flow graph: `grid.power` > 0 imports and
 * `battery.power` > 0 discharges, so exporting and charging are the negative
 * sides and an import is 0 exported rather than a negative export.
 */
function drawnOff(one: MetricSeries, t: number): number | null {
  const value = at(one, t);
  return value === null ? null : kw(Math.max(0, -value));
}

/**
 * Whether this bucket's run state is one that wrote nothing.
 *
 * A rollup returns the time-weighted MEAN, so a minute holding one shadow tick
 * and one simulating tick averages between them — hence a range rather than an
 * equality. Both ends mean the register was not touched.
 */
function isShadow(state: number | null): boolean {
  return state !== null && state >= SHADOW_STATE && state <= SIMULATING_STATE;
}

/** One bucket of every series, as one plotted row. */
function decisionRow(series: DecisionSeries, t: number): DecisionRow {
  const targetA = num(series.targetA, t);
  const pvW = num(series.pvW, t);
  // What the decision asks the battery to take, in power terms — the ceiling is
  // a current, and the charts are a power plane. A plant that meters no pack
  // voltage cannot make that conversion, and says so with a flat zero rather
  // than by inventing a nominal.
  const plannedChargeW = targetA * num(series.batteryV, t);
  return {
    t: new Date(t),
    pvKw: kw(pvW),
    loadKw: kw(num(series.loadW, t)),
    exportKw: kw(Math.max(0, pvW - num(series.localSinkW, t) - plannedChargeW)),
    batteryKw: kw(plannedChargeW),
    thresholdKw: kw(num(series.thresholdW, t)),
    targetA,
    registerA: at(series.appliedA, t),
    measuredExportKw: drawnOff(series.gridW, t),
    measuredChargeKw: drawnOff(series.batteryW, t),
    shadow: isShadow(at(series.state, t)),
  };
}

/**
 * Assemble the rows.
 *
 * ANCHORED ON THE DECISION, not on the plant: a bucket the optimizer said
 * nothing in is not a decision, and plotting the plant's readings there would
 * draw a ceiling the automation never asked for. The plant's series fill in
 * around whatever the optimizer decided.
 */
export function toDecisionRows(series: DecisionSeries): DecisionRow[] {
  const buckets = decimate(seriesTimestamps(series.targetA, series.thresholdW));
  return buckets.map((t) => decisionRow(series, t));
}

/** Whether the rows carry the reading a series needs (else it is not plotted). */
export const hasLoad = (rows: readonly DecisionRow[]): boolean => rows.some((r) => r.loadKw !== 0);
export const hasRegister = (rows: readonly DecisionRow[]): boolean =>
  rows.some((r) => r.registerA !== null);
