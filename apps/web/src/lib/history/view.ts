// What the statistics screen shows beside its range, as the hash route holds it (ADR 21): the
// figure asked about (`metric`), its tab, the baseline (`cmp`) and a chosen string (`sid`).
import { parseFigure } from "../detail/figures.ts";

export type Metric = "energy" | "money" | "autarky" | "plant";

export type Tab =
  | "time"
  | "years"
  | "pattern"
  | "forecast"
  | "tariff"
  | "payback"
  | "strings"
  | "battery"
  | "data";

export type Compare = "prev" | "year";

export const METRICS: readonly Metric[] = ["energy", "money", "autarky", "plant"];

const TABS: Readonly<Record<Metric, readonly Tab[]>> = {
  energy: ["time", "years", "pattern", "forecast"],
  money: ["time", "years", "tariff", "payback"],
  autarky: ["time", "years", "pattern"],
  plant: ["strings", "battery", "data"],
};

/** The route's parameters the view owns, beside the range's. */
export const VIEW_PARAMS = ["metric", "tab", "cmp", "sid"] as const;

export interface StatsView {
  readonly metric: Metric;
  readonly tab: Tab;
  readonly cmp: Compare;
  readonly sid: number | null;
}

const isMetric = (s: string | null): s is Metric => METRICS.some((m) => m === s);

/** A figure's tabs; a plant without a battery has no battery tab. */
export function tabsOf(metric: Metric, battery: boolean): Tab[] {
  return TABS[metric].filter((t) => t !== "battery" || battery);
}

export function viewOf(p: Readonly<URLSearchParams>, battery: boolean): StatsView {
  const named = p.get("metric");
  const metric = isMetric(named) ? named : "energy";
  const tabs = tabsOf(metric, battery);
  const sid = Number(p.get("sid") ?? Number.NaN);

  return {
    metric,
    tab: tabs.find((t) => t === p.get("tab")) ?? tabs[0]!,
    cmp: p.get("cmp") === "year" ? "year" : "prev",
    sid: Number.isInteger(sid) ? sid : null,
  };
}

const FIGURES = new Map<string, readonly [Metric | null, Tab | null]>([
  ["saved", ["money", null]],
  ["price", ["money", "tariff"]],
  ["autarky", ["autarky", null]],
  ["forecast", [null, "forecast"]],
  ["battery", ["plant", "battery"]],
  ["inverter", ["plant", "data"]],
]);

/** Where a detail sheet's figure lands: its view's parameters, null for the default. */
export function figureView(id: string): Record<"metric" | "tab" | "sid", string | null> {
  const ref = parseFigure(id);

  if (ref?.kind === "string") return { metric: "plant", tab: "strings", sid: String(ref.id) };

  const [metric, tab] = FIGURES.get(id) ?? [null, null];

  return { metric, tab, sid: null };
}
