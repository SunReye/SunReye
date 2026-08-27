/**
 * Turns the engine's decision log into plottable rows.
 *
 * Pure on purpose: the whole conversion (unit scaling, the modelled export the
 * decision implies, the plot window and the decimation that keeps a 24 h ring
 * from becoming 2 880 path points) is unit-tested here instead of living inside
 * a chart component.
 */

import type { DecisionPoint } from "$lib/automations";

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
  /** What the register actually held — unchanged from the user's value in shadow. */
  registerA: number | null;
  /** Measured export, tooltip only; null when `grid.power` is unmapped. */
  measuredExportKw: number | null;
  /** Measured charging, tooltip only; null when `battery.power` is unmapped. */
  measuredChargeKw: number | null;
  /** True when this tick only simulated. */
  shadow: boolean;
};

/**
 * Plot-point ceiling. A 24 h ring at the 30 s tick is 2 880 samples; past ~700
 * the extra path nodes are sub-pixel on any real chart width and only cost
 * render time, so longer windows are strided down to this many.
 */
// fallow-ignore-next-line unused-export -- the cap is asserted by decision-series.test.ts; web test files aren't traced as consumers
export const MAX_PLOT_POINTS = 720;

/** Selectable plot windows, newest-anchored. */
export const DECISION_WINDOWS = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
} as const;

export type DecisionWindow = keyof typeof DECISION_WINDOWS;

const kw = (watts: number) => watts / 1000;

function toRow(p: DecisionPoint): DecisionRow {
  // What the decision asks the battery to take, in power terms — the ceiling is
  // a current, and the charts are a power plane.
  const plannedChargeW = p.targetA * p.batteryV;
  return {
    t: new Date(p.t),
    pvKw: kw(p.pvW),
    loadKw: kw(p.loadW ?? 0),
    exportKw: kw(Math.max(0, p.pvW - p.localSinkW - plannedChargeW)),
    batteryKw: kw(plannedChargeW),
    thresholdKw: kw(p.thresholdW),
    targetA: p.targetA,
    registerA: p.liveA,
    measuredExportKw: p.exportW === null ? null : kw(p.exportW),
    measuredChargeKw: p.chargeW === null ? null : kw(p.chargeW),
    shadow: p.shadow,
  };
}

/**
 * Rows for the selected window, oldest → newest, strided to at most
 * {@link MAX_PLOT_POINTS}. The newest sample is always kept so the plot's right
 * edge tracks the live tick rather than the last stride multiple.
 */
export function sampleWindow<T extends { t: number }>(items: T[], windowMs: number): T[] {
  const newest = items.at(-1);
  if (!newest) return [];
  const from = newest.t - windowMs;
  const inWindow = items.filter((p) => p.t >= from);
  const stride = Math.ceil(inWindow.length / MAX_PLOT_POINTS);
  if (stride <= 1) return inWindow;
  const kept = inWindow.filter((_, i) => i % stride === 0);
  if (kept.at(-1) !== inWindow.at(-1)) kept.push(inWindow[inWindow.length - 1]!);
  return kept;
}

export function toDecisionRows(points: DecisionPoint[], windowMs: number): DecisionRow[] {
  return sampleWindow(points, windowMs).map(toRow);
}

/** Whether any point carries the reading a series needs (else it's not plotted). */
export const hasLoad = (points: DecisionPoint[]): boolean => points.some((p) => p.loadW !== null);
export const hasRegister = (points: DecisionPoint[]): boolean =>
  points.some((p) => p.liveA !== null);
