// What the history and statistics screen reads (ADR 11): the core picks history's tier and cuts
// statistics in the plant timezone, so the SPA only chooses spans back from now.
import type { Core, History, Period, Statistics, Values } from "../api/core.ts";
import { PLANT } from "../live/labels.ts";

export type Figures = Statistics["points"][number];

/** One device and the series it publishes, sorted. */
export interface Choice {
  readonly device: number;
  readonly series: readonly string[];
}

/** Each live device and its series: the plant first, then by id. */
export function choices(devices: Values["devices"]): Choice[] {
  const ids = Object.keys(devices)
    .map(Number)
    .toSorted((a, b) => rank(a) - rank(b) || a - b);

  return ids.map((device) => ({
    device,
    series: Object.keys(devices[device] ?? {}).toSorted((a, b) => a.localeCompare(b)),
  }));
}

function rank(device: number): number {
  return String(device) === PLANT ? 0 : 1;
}

/** The history chart's spans, in days back from now. */
const SPANS = { day: 1, week: 7, month: 30, year: 365 } as const;

export type Span = keyof typeof SPANS;

/** How far back each period's statistics reach, in days: a month of days, a quarter of weeks. */
const LOOKBACK: Readonly<Record<Period, number>> = { day: 31, week: 84, month: 365 };

const DAY_MS = 86_400_000;

/** One line point, as the shared power chart draws it. */
export interface Row {
  readonly time: Date;
  readonly power: number;
  readonly series: string;
}

/** The series' points over the span up to now, at the tier the core picks (ADR 9). */
export async function historyRows(
  core: Readonly<Pick<Core, "history">>,
  device: number,
  series: string,
  span: Span,
): Promise<Row[]> {
  const to = new Date();
  const from = new Date(to.getTime() - SPANS[span] * DAY_MS);
  const history = await core.history(device, series, from, to);

  return "points" in history
    ? history.points.map((p: Readonly<History["points"][number]>) => ({
        time: new Date(p.start),
        power: p.mean,
        series,
      }))
    : [];
}

/** Each period's figures up to now, cut by the core in the plant timezone (ADR 3). */
export async function periodFigures(
  core: Readonly<Pick<Core, "statistics">>,
  device: number,
  series: string,
  period: Period,
): Promise<Figures[]> {
  const to = new Date();
  const from = new Date(to.getTime() - LOOKBACK[period] * DAY_MS);
  const read = await core.statistics(device, series, period, from, to);

  return "points" in read ? read.points : [];
}

/** A period's energy in kWh: a counter's delta, or a power's integral; null for anything else. */
export function energy(series: string, figures: Readonly<Figures>): number | null {
  const role = series.replace(/\[\d+\]$/u, "");
  const delta = figures.delta ?? null;
  const integral = figures.integral ?? null;

  if (delta !== null) return role.endsWith(".total") || role === "ev.session.energy" ? delta : null;

  return role.endsWith(".power") && integral !== null ? integral / 1000 : null;
}
