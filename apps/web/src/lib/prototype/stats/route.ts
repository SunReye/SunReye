// PROTOTYPE: the Statistics screen's state as hash-route parameters (ADR 21), so back works and a
// detail sheet deep-links: range=day|week|month|year|custom, at=<date in the range>, from/to for
// custom (a date, or date and hour: 2026-06-12T08), metric, tab, cmp=prev|year, sid=<string id>.
import type { Via } from "./BandChart.svelte";
import { dateOf, dayIndex, type History } from "./history";
import { selFor, spanSel, type Bucket, type Compare, type Kind, type Sel, type Sum } from "./query";

export type Metric = "energy" | "money" | "autarky" | "plant";
export type Tab = "time" | "years" | "pattern" | "forecast" | "tariff" | "payback" | "strings" | "battery" | "data";

export const TABS: Record<Metric, { id: Tab; label: string }[]> = {
  energy: [{ id: "time", label: "Verlauf" }, { id: "years", label: "Jahre" }, { id: "pattern", label: "Muster" }, { id: "forecast", label: "Prognose" }],
  money: [{ id: "time", label: "Verlauf" }, { id: "years", label: "Jahre" }, { id: "tariff", label: "Tarif" }, { id: "payback", label: "Amortisation" }],
  autarky: [{ id: "time", label: "Verlauf" }, { id: "years", label: "Jahre" }, { id: "pattern", label: "Muster" }],
  plant: [{ id: "strings", label: "Strings" }, { id: "battery", label: "Batterie" }, { id: "data", label: "Daten" }],
};

export interface StatsRoute {
  sel: Sel;
  metric: Metric;
  tab: Tab;
  cmp: Compare;
  sid: string | null;
}

const KINDS: Kind[] = ["day", "week", "month", "year", "custom"];

export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function day(h: History, s: string | null): number | null {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? dayIndex(h.start, new Date(+m[1]!, +m[2]! - 1, +m[3]!)) : null;
}
/** The hour a custom bound names: `T08` on a start is 08:00, on an end it is up to 08:00; no hour is the whole day. */
function hour(h: History, s: string | null, end: boolean): number | null {
  const d = day(h, s);
  if (d === null) return null;
  const m = s!.match(/T(\d{2})$/);
  return d * 24 + (m ? Math.min(24, +m[1]!) : end ? 24 : 0);
}

export function parseRoute(h: History, p: URLSearchParams, hasBattery: boolean): StatsRoute {
  const kind = KINDS.includes(p.get("range") as Kind) ? (p.get("range") as Kind) : "month";
  const at = Math.min(h.today, Math.max(0, day(h, p.get("at")) ?? h.today));
  const sel = kind === "custom" ? spanSel(h, hour(h, p.get("from"), false) ?? 0, hour(h, p.get("to"), true) ?? (h.today + 1) * 24) : selFor(h, kind, at);
  const metric = (p.get("metric") ?? "") in TABS ? (p.get("metric") as Metric) : "energy";
  const tabs = TABS[metric].filter((t) => t.id !== "battery" || hasBattery);
  const tab = tabs.find((t) => t.id === p.get("tab"))?.id ?? tabs[0]!.id;
  return { sel, metric, tab, cmp: p.get("cmp") === "year" ? "year" : "prev", sid: p.get("sid") };
}

const at = (hr: number | undefined) => (hr === undefined ? "" : `T${String(hr).padStart(2, "0")}`);

/** The parameters that put a range into the route. */
export function selParams(h: History, sel: Sel): Record<string, string | null> {
  if (sel.kind === "custom") return { range: "custom", at: null, from: iso(dateOf(h.start, sel.from)) + at(sel.h0), to: iso(dateOf(h.start, sel.to - 1)) + at(sel.h1) };
  // The anchor is the range's first recorded day, so a month that began before recording still resolves.
  const current = sel.from <= h.today && h.today < sel.to;
  return { range: sel.kind, at: current ? null : iso(dateOf(h.start, Math.max(0, sel.from))), from: null, to: null };
}

/** Every parameter the screen owns; leaving the screen clears them. */
export const STATS_PARAMS = ["range", "at", "from", "to", "metric", "tab", "cmp", "sid"];

/** What every panel reads. */
export interface Q {
  h: History;
  sel: Sel;
  bs: Bucket[];
  tot: Sum;
  live: Sum;
  /** The compared span, band by band, and its name. */
  cmp: { label: string; bands: (Sum | null)[]; sum: Sum } | null;
  /** How the range got here, for a chart that morphs or zooms. */
  via: Via;
  metric: Metric;
  loading: boolean;
  /** Recording began days ago. */
  fresh: boolean;
  /** Drill into a range; pushes a history entry. */
  open: (sel: Sel) => void;
  view: (metric: Metric, tab: Tab) => void;
}

/** Where a detail sheet's figure lands on the Statistics screen. */
export function detailView(id: string): Record<string, string | null> {
  if (/^s\d$/.test(id)) return { metric: "plant", tab: "strings", sid: id };
  const map: Record<string, [Metric, Tab?]> = { saved: ["money"], price: ["money", "tariff"], autarky: ["autarky"], battery: ["plant", "battery"], forecast: ["energy", "forecast"] };
  const [metric, tab] = map[id] ?? ["energy"];
  return { metric: metric === "energy" ? null : metric, tab: tab ?? null };
}
