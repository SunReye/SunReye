// The benchmark's arithmetic (ADR 24): budgets, percentiles, breaches and the cgroup files read
// from the host.

export type Unit = "ms" | "bytes" | "bytes/day";

export interface Budget {
  readonly max: number;
  readonly unit: Unit;
  readonly label: string;
}

const MB = 2 ** 20;

function budget(max: number, unit: Unit, label: string): Budget {
  return { max, unit, label };
}

/** ADR 24's budgets, at 0.5 CPU and 64 MB on the ten-year file. */
export const BUDGETS = {
  screenWarm: budget(150, "ms", "≤ 150 ms"),
  screenCold: budget(1000, "ms", "≤ 1 s"),
  read: budget(100, "ms", "≤ 100 ms"),
  startup: budget(5000, "ms", "≤ 5 s"),
  expiry: budget(200, "ms", "≤ 200 ms"),
  job: budget(30_000, "ms", "≤ 30 s"),
  ioThread: budget(50, "ms", "≤ 50 ms"),
  backup: budget(120_000, "ms", "≤ 2 min"),
  memory: budget(48 * MB, "bytes", "≤ 48 MB"),
  writes: budget(50 * MB, "bytes/day", "≤ 50 MB a day"),
} as const;

/** A measurement: a number in its unit, why it failed, or why it was not taken. */
export type Row = {
  readonly measurement: string;
  readonly budget: Budget | null;
  /** The unit of a result without a budget. */
  readonly unit?: Unit;
} & ({ readonly result: number } | { readonly failed: string } | { readonly skipped: string });

/** `value` against `budget`, or a failure when it met `error`. */
export function measured(
  measurement: string,
  limit: Budget,
  value: number,
  error: string | null,
): Row {
  return error === null
    ? { measurement, budget: limit, result: value }
    : { measurement, budget: limit, failed: error };
}

function format(value: number, unit: Unit): string {
  if (unit === "ms")
    return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`;

  return `${(value / MB).toFixed(1)} ${unit === "bytes" ? "MB" : "MB/day"}`;
}

function cells(row: Row): readonly [result: string, verdict: string] {
  if ("skipped" in row) return [`not measured: ${row.skipped}`, row.budget ? "n/a" : "—"];

  if ("failed" in row) return [row.failed, "FAIL"];

  const { result, budget: limit } = row;
  const shown = format(result, limit?.unit ?? row.unit ?? "ms");

  if (limit === null) return [shown, "—"];

  return [shown, result <= limit.max ? "pass" : "FAIL"];
}

export interface Table {
  readonly lines: readonly string[];
  readonly breaches: number;
}

/** The results as a Markdown table beside their budgets, and how many breached. */
export function table(rows: readonly Row[]): Table {
  const lines = ["| measurement | budget | result | verdict |", "|---|---|---|---|"];
  let breaches = 0;

  for (const row of rows) {
    const [result, verdict] = cells(row);

    if (verdict === "FAIL") breaches += 1;
    lines.push(`| ${row.measurement} | ${row.budget?.label ?? "—"} | ${result} | ${verdict} |`);
  }

  return { lines, breaches };
}

/** The nearest-rank 95th percentile. */
export function p95(samples: readonly number[]): number {
  const sorted = samples.toSorted((a, b) => a - b);

  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? Number.NaN;
}

/** A read's route: its path with ids as `{id}`, and a statistics read's period. */
export function route(path: string): string {
  const [template = "", query = ""] = path.replaceAll(/\/\d+(?=\/|\?|$)/gu, "/{id}").split("?");
  const period = new URLSearchParams(query).get("period");

  return period === null ? template : `${template}?period=${period}`;
}

/**
 * Bytes written, from a cgroup's `io.stat`. Each layer of a device-mapper stack repeats the same
 * bytes, so the busiest device counts, not their sum.
 */
export function written(ioStat: string): number {
  let most = 0;

  for (const [, bytes = "0"] of ioStat.matchAll(/\bwbytes=(\d+)/gu))
    most = Math.max(most, Number(bytes));

  return most;
}

export interface Timing {
  readonly path: string;
  readonly ms: number;
}

export interface Slowest {
  readonly route: string;
  /** The route's request with the highest p95. */
  readonly path: string;
  readonly p95: number;
  readonly samples: number;
}

/**
 * Each route's slowest request by its own p95, routes in order. Pooling a route's requests would
 * hide a year-long read among many day-long ones.
 */
export function slowest(timings: readonly Timing[]): Slowest[] {
  const byPath = Map.groupBy(timings, (timing) => timing.path);
  const worst = new Map<string, Slowest>();

  for (const [path, times] of byPath) {
    const found = {
      route: route(path),
      path,
      p95: p95(times.map((t) => t.ms)),
      samples: times.length,
    };

    const known = worst.get(found.route);

    if (known === undefined || found.p95 > known.p95) worst.set(found.route, found);
  }

  return [...worst.keys()].toSorted().flatMap((name) => worst.get(name) ?? []);
}

/** `bytes` written over `window` ms, scaled to a day. */
export function perDay(bytes: number, window: number): number {
  return (bytes * 86_400_000) / window;
}

/** The `key value` lines of a cgroup file such as `memory.stat`. */
function keyed(text: string): Map<string, number> {
  const values = new Map<string, number>();

  for (const [, key = "", value = ""] of text.matchAll(/^(\S+) (\d+)$/gmu))
    values.set(key, Number(value));

  return values;
}

export interface InUse {
  /** `memory.current` less the inactive file cache, as `docker stats` counts it. */
  readonly workingSet: number;
  /** Anonymous memory: the heap and stacks. */
  readonly anon: number;
}

/** Bytes in use, from a cgroup's `memory.current` and `memory.stat`. */
export function inUse(current: string, memoryStat: string): InUse {
  const stat = keyed(memoryStat);

  return {
    workingSet: Number(current.trim()) - (stat.get("inactive_file") ?? 0),
    anon: stat.get("anon") ?? 0,
  };
}

export interface Cpu {
  /** Milliseconds of CPU used. */
  readonly usage: number;
  /** Milliseconds the quota held every thread. */
  readonly throttled: number;
}

/** CPU used and throttled, from a cgroup's `cpu.stat`. */
export function cpu(cpuStat: string): Cpu {
  const stat = keyed(cpuStat);

  return {
    usage: (stat.get("usage_usec") ?? 0) / 1000,
    throttled: (stat.get("throttled_usec") ?? 0) / 1000,
  };
}
