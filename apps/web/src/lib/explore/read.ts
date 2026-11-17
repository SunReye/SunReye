// Where a series' curve is read from, by its kind and the span (ADR 22): history up to a day,
// statistics past it; a status or held value from history at any range. One read per series, and
// one that fails leaves the others standing.
import type { Core, History, Period, Statistics } from "../api/core.ts";
import type { Curve, Draw, Sample, Tier } from "./curve.ts";
import type { Chosen } from "./picker.ts";

export type Reads = Readonly<Pick<Core, "history" | "statistics">>;

/** What a read needs of a chosen series. */
export type Read = Pick<Chosen, "ref" | "kind" | "first">;

export interface Reading {
  readonly curve: Curve;
  /** A day read by the hour: its change points have expired (ADR 3). */
  readonly hourly: boolean;
  /** `many`: a status changed more often than one read holds. `failed`: refused or unreachable. */
  readonly trouble: "failed" | "many" | null;
}

const HOUR = 3_600_000;

/** The core reads history raw or by the minute up to this span, and refuses a counter's past it. */
const RAW_SPAN = 24 * HOUR;

/** The longest span of hourly figures (ADR 9): 1,500 of them. */
const HOUR_SPAN = 1499 * HOUR;

type Kind = NonNullable<Chosen["kind"]>;

/** How each kind is drawn from history. */
const HISTORY: Readonly<Record<Kind, Draw>> = {
  measurement: "line",
  counter: "step",
  status: "states",
  held: "step",
};

/** The core's answers, read-only through and through. */
type Stored = Readonly<Omit<History, "points">> & {
  readonly points: readonly Readonly<History["points"][number]>[];
};

type Figured = Readonly<Omit<Statistics, "points">> & {
  readonly points: readonly Readonly<Statistics["points"][number]>[];
};

function historyCurve(draw: Draw, got: Stored): Curve {
  return {
    draw,
    tier: got.tier,
    width: got.width ?? undefined,
    samples: got.points.map((p: Readonly<History["points"][number]>) => ({
      t0: Date.parse(p.start),
      t1: Date.parse(p.end),
      v: p.mean,
    })),
  };
}

/** A measurement's means with their extremes, or a counter's deltas; a period without is a gap. */
function statisticsCurve(counter: boolean, tier: Tier, got: Figured): Curve {
  const samples = got.points.flatMap((f: Readonly<Statistics["points"][number]>): Sample[] => {
    const span = { t0: Date.parse(f.start), t1: Date.parse(f.end) };
    const v = counter ? f.delta : f.mean;

    if (v === undefined || v === null) return [];

    return [counter ? { ...span, v } : { ...span, v, lo: f.min ?? v, hi: f.max ?? v }];
  });

  return { draw: counter ? "bars" : "line", tier, samples };
}

const failed = (curve: Curve, trouble: Reading["trouble"] = "failed"): Reading => ({
  curve,
  hourly: false,
  trouble,
});

const fine = (curve: Curve, hourly = false): Reading => ({ curve, hourly, trouble: null });

/** One series' read: where from, and what an empty or refused answer leaves. */
interface Ask {
  readonly core: Reads;
  readonly s: Read;
  readonly kind: Kind;
  readonly from: Readonly<Date>;
  readonly to: Readonly<Date>;
  /** Nothing drawn, as the kind draws from history. */
  readonly none: Curve;
}

/** The series' statistics; `hourly` when they stand in for a day's expired change points. */
async function figures(ask: Ask, period: Period & Tier, hourly: boolean): Promise<Reading> {
  const { device, series } = ask.s.ref;
  const got = await ask.core.statistics(device, series, period, ask.from, ask.to);

  if ("problem" in got) return failed(ask.none);

  const curve = statisticsCurve(ask.kind === "counter", period, got);

  // In place of expired change points, hours without figures are a gap like any other.
  return hourly && curve.samples.length === 0 ? fine(ask.none) : fine(curve, hourly);
}

async function history(ask: Ask, rolled: boolean): Promise<Reading> {
  const { device, series } = ask.s.ref;
  const got = await ask.core.history(device, series, ask.from, ask.to);

  // Only a status or held value is refused for its changes (ADR 9): past 1,500 raw intervals.
  if ("problem" in got)
    return failed(ask.none, !rolled && got.problem === "history.range" ? "many" : "failed");

  if (rolled && got.points.length === 0) return figures(ask, "hour", true);

  return fine(historyCurve(HISTORY[ask.kind], got));
}

function read(ask: Ask): Promise<Reading> {
  const { s, kind, from, to } = ask;
  const span = to.getTime() - from.getTime();
  /** A measurement or a counter has rollups (ADR 3). */
  const rolled = kind === "measurement" || kind === "counter";

  if (s.first !== null && to.getTime() <= Date.parse(s.first))
    return Promise.resolve(fine(ask.none));

  if (rolled && span > RAW_SPAN) return figures(ask, span <= HOUR_SPAN ? "hour" : "day", false);

  return history(ask, rolled);
}

/** One series' curve from `from` to before `to`. */
export function readSeries(
  core: Reads,
  s: Read,
  from: Readonly<Date>,
  to: Readonly<Date>,
): Promise<Reading> {
  const kind = s.kind ?? "measurement";
  const none: Curve = { draw: HISTORY[kind], tier: "raw", samples: [] };

  // A read that throws fails like one that is refused.
  return Promise.resolve()
    .then(() => read({ core, s, kind, from, to, none }))
    .catch(() => failed(none));
}

/**
 * Whether the chart shows a day past retention that a status or held value has nothing of: such
 * a series has no rollups (ADR 3), so beside a series read by the hour it is empty for good.
 */
export function expired(
  drawn: readonly (Pick<Reading, "curve" | "hourly"> & Pick<Chosen, "kind">)[],
): boolean {
  return (
    drawn.some((d) => d.hourly) &&
    drawn.some((d) => (d.kind === "status" || d.kind === "held") && d.curve.samples.length === 0)
  );
}
