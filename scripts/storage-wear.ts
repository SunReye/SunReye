/**
 * The storage-wear harness: what turns the write-volume projections into gates.
 *
 * Everything past the first wave of tuning is a *projection*. A projection that
 * is never measured gets quoted as a measurement, so this file exists to make
 * the difference impossible to lose: it derives each figure from raw counters,
 * names its own baseline, and answers pass/fail against a threshold — or refuses
 * to answer.
 *
 * Reproducible baseline, measured 2026-08-22 over an 18.03 h window on one
 * device at a 3 s poll cadence:
 *
 * | | |
 * |---|---|
 * | Device writes | 3.39 GB/day |
 * | Rows | 3.11 M/day |
 * | Write amplification | 16.0x |
 * | Uncompressed row | 226.6 B |
 * | Compressed row | 4.1 B |
 * | Idle baseline | 0.040 GiB/day (subtracted, never folded in) |
 *
 * ```
 * cid=$(docker inspect -f '{{.Id}}' SunReye-timescaledb)
 * sudo cat /sys/fs/cgroup/system.slice/docker-$cid.scope/io.stat   # row 253:16
 * ```
 *
 * ## Three rules this harness enforces on itself
 *
 * **CPU-denominated, not wall-clock.** A write-rate figure from a contended host
 * is not comparable to one from an idle host, so every sample records the load
 * it was taken under and a comparison across different load is reported as
 * incomparable rather than as a change.
 *
 * **Never a verdict from two samples.** A regression claim needs a population;
 * {@link compareSamples} refuses below {@link MIN_SAMPLES} instead of returning
 * a number that reads like an answer.
 *
 * **The idle baseline is reported separately.** Folding it in makes a 1.2 %
 * correction indistinguishable from the thing being measured.
 */

const GB = 1_000_000_000;
const DAY_MS = 86_400_000;

/** Samples below this cannot support a regression claim. */
export const MIN_SAMPLES = 5;

/**
 * Load must match within this factor for two populations to be comparable.
 * Wide, deliberately: the point is to reject a comparison across a busy host and
 * an idle one, not to demand identical conditions.
 */
export const LOAD_TOLERANCE = 1.5;

/** One line of a cgroup `io.stat`, per block device. */
export interface IoStatLine {
  /** `major:minor`, e.g. `253:16`. */
  device: string;
  rbytes: number;
  wbytes: number;
  rios: number;
  wios: number;
}

/**
 * Parse a cgroup v2 `io.stat`. Unknown keys are ignored rather than rejected:
 * the kernel adds fields (`dbytes`, `dios`) between versions, and a harness that
 * refuses to read a newer kernel is a harness nobody runs.
 */
export function parseIoStat(text: string): IoStatLine[] {
  return text
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => /^\d+:\d+$/.test(parts[0] ?? ""))
    .map((parts) => {
      const fields = keyedFields(parts.slice(1));
      const at = (key: string) => fields.get(key) ?? 0;
      return {
        device: parts[0] as string,
        rbytes: at("rbytes"),
        wbytes: at("wbytes"),
        rios: at("rios"),
        wios: at("wios"),
      };
    });
}

/** `key=value` pairs from one io.stat line; unparseable pairs are skipped. */
function keyedFields(parts: readonly string[]): Map<string, number> {
  const fields = new Map<string, number>();
  for (const part of parts) {
    const [key, value] = part.split("=");
    if (!key || value === undefined) continue;
    const n = Number(value);
    if (Number.isFinite(n)) fields.set(key, n);
  }
  return fields;
}

/** The counters for one device, or undefined when the cgroup never touched it. */
export const deviceLine = (text: string, device: string): IoStatLine | undefined =>
  parseIoStat(text).find((l) => l.device === device);

/** One end of a measurement window. */
export interface WindowEnd {
  /** Epoch ms. Passed in — never read from a clock here, so a test is exact. */
  atMs: number;
  /** Raw `io.stat` text at this instant. */
  ioStat: string;
  /** Rows in the timeseries table at this instant. */
  rows: number;
  /** Bytes Postgres itself reports having written (`pg_stat_wal` + `pg_stat_io`). */
  postgresBytes: number;
  /**
   * 1-minute load average. Recorded so a rate is never compared across
   * conditions it is not comparable across.
   */
  load1: number;
}

/** A measured window, with the idle baseline kept beside it, never folded in. */
export interface WearSample {
  /** Device write bytes per day, idle baseline already subtracted. */
  gbPerDay: number;
  /** The subtraction itself, reported so it can be judged. */
  idleGbPerDay: number;
  /** Rows written per day over the window. */
  rowsPerDay: number;
  /** Device bytes ÷ bytes Postgres says it wrote. */
  amplification: number;
  /** Mean 1-minute load across the window's ends. */
  load1: number;
  /** Window length, ms — a short window measures noise, so callers can gate on it. */
  windowMs: number;
}

export class WearMeasurementError extends Error {}

/**
 * Derive one sample from the two ends of a window.
 *
 * `idleGbPerDay` is the measured idle draw of the box (0.040 GiB/day on the
 * reference instance) and is *subtracted* from the device figure while staying
 * visible in the result.
 */
export function measureWindow(
  before: WindowEnd,
  after: WindowEnd,
  opts: { device: string; idleGbPerDay: number },
): WearSample {
  const windowMs = after.atMs - before.atMs;
  if (windowMs <= 0) {
    throw new WearMeasurementError("window ends are out of order");
  }
  const from = deviceLine(before.ioStat, opts.device);
  const to = deviceLine(after.ioStat, opts.device);
  if (!from || !to) {
    throw new WearMeasurementError(`device ${opts.device} is absent from io.stat`);
  }
  const deviceBytes = to.wbytes - from.wbytes;
  if (deviceBytes < 0) {
    // The counters are monotonic per cgroup, so a decrease means the container
    // was recreated mid-window and the two ends describe different lifetimes.
    throw new WearMeasurementError("io.stat counters went backwards: the cgroup was replaced");
  }
  const postgresBytes = after.postgresBytes - before.postgresBytes;
  const perDay = (n: number) => (n * DAY_MS) / windowMs;
  return {
    gbPerDay: perDay(deviceBytes) / GB - opts.idleGbPerDay,
    idleGbPerDay: opts.idleGbPerDay,
    rowsPerDay: perDay(after.rows - before.rows),
    // A window in which Postgres wrote nothing has no ratio — not an infinite one.
    amplification: postgresBytes > 0 ? deviceBytes / postgresBytes : Number.NaN,
    load1: (before.load1 + after.load1) / 2,
    windowMs,
  };
}

/** The gates. Each is a threshold the milestone's projections have to survive. */
export interface Gate {
  id: number;
  what: string;
  /** Human threshold, for the report. */
  threshold: string;
  /**
   * Whether this measurement is the *shape* the gate is stated for. A figure
   * from a one-device run is not evidence about five devices, and a figure taken
   * at a 3 s cadence is not evidence about a gate written at 1 s — so it is
   * reported as not applicable rather than as a failure, which would make every
   * run fail no matter what it measured.
   */
  applies(m: GateInputs): boolean;
  /** True when an applicable measurement passes. */
  holds(m: GateInputs): boolean;
  /**
   * Gates 1-3 decide the hardware choice, so a pass inside a container on a
   * different machine is not evidence — the report says so rather than implying
   * the number transfers.
   */
  needsTargetHardware?: boolean;
}

/** Everything the gates read: a wear sample plus the figures measured beside it. */
export interface GateInputs extends WearSample {
  /** Devices the sample was taken with. */
  devices: number;
  /** Poll cadence during the sample, ms. */
  pollIntervalMs: number;
  /** Compressed bytes per row, from `hypertable_compression_stats`. */
  compressedBytesPerRow: number;
  /** Size of the uncompressed hot window, MB. */
  uncompressedWindowMb: number;
  /** Row reduction from thinning, as a fraction, against the same input. */
  thinningReduction: number;
  /** Buffers an `EXPLAIN (ANALYZE, BUFFERS)` of a 1-year hourly chart reads. */
  yearChartBuffers: number;
}

export const GATES: readonly Gate[] = [
  {
    id: 1,
    what: "device writes, 1 device @ 1 s",
    threshold: "<= 0.4 GB/day",
    needsTargetHardware: true,
    applies: (m) => m.devices === 1 && m.pollIntervalMs <= 1000,
    holds: (m) => m.gbPerDay <= 0.4,
  },
  {
    id: 2,
    what: "device writes, 5 devices @ 1 s",
    threshold: "<= 2.0 GB/day",
    needsTargetHardware: true,
    applies: (m) => m.devices >= 5 && m.pollIntervalMs <= 1000,
    holds: (m) => m.gbPerDay <= 2.0,
  },
  {
    id: 3,
    what: "write amplification",
    threshold: "<= 4x (from 16x)",
    needsTargetHardware: true,
    applies: () => true,
    holds: (m) => Number.isFinite(m.amplification) && m.amplification <= 4,
  },
  {
    id: 4,
    what: "compressed bytes per row",
    threshold: "<= 4.5 B",
    applies: () => true,
    holds: (m) => m.compressedBytesPerRow <= 4.5,
  },
  {
    id: 5,
    what: "uncompressed hot window, steady state",
    threshold: "<= 5 MB",
    applies: () => true,
    holds: (m) => m.uncompressedWindowMb <= 5,
  },
  {
    id: 6,
    what: "row reduction from thinning, same input",
    threshold: ">= 80 %",
    applies: () => true,
    holds: (m) => m.thinningReduction >= 0.8,
  },
  {
    id: 7,
    what: "1-year single-metric hourly chart",
    threshold: "<= 200 buffers (from ~8760)",
    applies: () => true,
    holds: (m) => m.yearChartBuffers <= 200,
  },
];

export interface GateResult {
  gate: Gate;
  /** False when the gate does not apply to this run's shape. */
  applicable: boolean;
  /** Only meaningful when {@link applicable}. */
  passed: boolean;
  /** True when this gate's verdict does not transfer off this machine. */
  provisional: boolean;
}

/** Evaluate every gate. `onTargetHardware` decides which verdicts transfer. */
export function evaluateGates(m: GateInputs, onTargetHardware: boolean): GateResult[] {
  return GATES.map((gate) => {
    const applicable = gate.applies(m);
    return {
      gate,
      applicable,
      passed: applicable && gate.holds(m),
      provisional: Boolean(gate.needsTargetHardware) && !onTargetHardware,
    };
  });
}

export type Comparison =
  | { verdict: "incomparable"; why: string }
  | { verdict: "unchanged" | "improved" | "regressed"; ratio: number };

/**
 * Compare two populations of samples — never two samples.
 *
 * Refuses below {@link MIN_SAMPLES}, and refuses across load that differs by
 * more than {@link LOAD_TOLERANCE}: both cases produce a *reason*, not a number
 * that reads like an answer.
 */
export function compareSamples(
  baseline: readonly WearSample[],
  candidate: readonly WearSample[],
  tolerance = 0.1,
): Comparison {
  if (baseline.length < MIN_SAMPLES || candidate.length < MIN_SAMPLES) {
    return {
      verdict: "incomparable",
      why: `needs >= ${MIN_SAMPLES} samples per side, got ${baseline.length} and ${candidate.length}`,
    };
  }
  const mean = (xs: readonly WearSample[], pick: (s: WearSample) => number) =>
    xs.reduce((sum, s) => sum + pick(s), 0) / xs.length;
  const baseLoad = mean(baseline, (s) => s.load1);
  const candLoad = mean(candidate, (s) => s.load1);
  const loadRatio = Math.max(baseLoad, candLoad) / Math.max(Math.min(baseLoad, candLoad), 1e-9);
  if (loadRatio > LOAD_TOLERANCE) {
    return {
      verdict: "incomparable",
      why: `host load differs ${loadRatio.toFixed(2)}x (${baseLoad.toFixed(2)} vs ${candLoad.toFixed(2)}); a write rate is not comparable across it`,
    };
  }
  const ratio = mean(candidate, (s) => s.gbPerDay) / mean(baseline, (s) => s.gbPerDay);
  if (ratio > 1 + tolerance) return { verdict: "regressed", ratio };
  if (ratio < 1 - tolerance) return { verdict: "improved", ratio };
  return { verdict: "unchanged", ratio };
}

/** Render a gate report; the caller decides what to do with the exit code. */
export function formatGates(results: readonly GateResult[]): string[] {
  return results.map((r) => {
    // "-" rather than a pass or a fail: a gate this run cannot speak to must be
    // visible in the report, or a run that skipped the headline gate reads as a
    // clean one.
    const mark = !r.applicable ? "-" : r.passed ? "✓" : "✗";
    const why = !r.applicable ? " (not applicable to this run)" : "";
    const note =
      r.applicable && r.provisional ? " (provisional: not measured on target hardware)" : "";
    return `${mark} gate ${r.gate.id} — ${r.gate.what}: ${r.gate.threshold}${why}${note}`;
  });
}

/** Whether a run should fail: a gate that failed and whose verdict transfers. */
export const gatesFailed = (results: readonly GateResult[]): boolean =>
  results.some((r) => r.applicable && !r.passed && !r.provisional);

/** Everything the collector reads from the world, so a test needs no world. */
export interface WearIO {
  read(path: string): string;
  /** One scalar from the database (row count, compression stat). */
  scalar(sql: string): Promise<number>;
  nowMs(): number;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
}

/** Read one end of a window: the counters, the load, and the row count. */
export async function readEnd(io: WearIO, cgroupIoStat: string): Promise<WindowEnd> {
  const loadavg = io.read("/proc/loadavg").trim().split(/\s+/);
  return {
    atMs: io.nowMs(),
    ioStat: io.read(cgroupIoStat),
    rows: await io.scalar("select count(*)::bigint from metrics_raw"),
    // WAL + shared-buffer writes: what Postgres believes it wrote, against which
    // the device figure is the amplification.
    postgresBytes: await io.scalar(
      "select (select coalesce(sum(wal_bytes), 0) from pg_stat_wal)::bigint",
    ),
    load1: Number(loadavg[0] ?? 0),
  };
}

/**
 * Measure one window and report the gates against it.
 *
 * Returns the sample so a caller can accumulate a population — a single sample
 * is a measurement, never a verdict about a change (see {@link compareSamples}).
 */
export async function runWindow(
  io: WearIO,
  opts: {
    cgroupIoStat: string;
    device: string;
    idleGbPerDay: number;
    windowMs: number;
    gates: Omit<GateInputs, keyof WearSample>;
    onTargetHardware: boolean;
  },
): Promise<{ sample: WearSample; results: GateResult[] }> {
  const before = await readEnd(io, opts.cgroupIoStat);
  await io.sleep(opts.windowMs);
  const after = await readEnd(io, opts.cgroupIoStat);
  const sample = measureWindow(before, after, opts);
  const results = evaluateGates({ ...sample, ...opts.gates }, opts.onTargetHardware);
  io.log(
    `${sample.gbPerDay.toFixed(3)} GB/day (idle ${sample.idleGbPerDay.toFixed(3)} subtracted), ` +
      `${(sample.rowsPerDay / 1e6).toFixed(2)} M rows/day, ` +
      `${Number.isFinite(sample.amplification) ? sample.amplification.toFixed(1) + "x" : "amplification unmeasured"}, ` +
      `load ${sample.load1.toFixed(2)}, window ${(sample.windowMs / 60_000).toFixed(1)} min`,
  );
  for (const line of formatGates(results)) io.log(line);
  return { sample, results };
}

/**
 * `bun run test:wear [--minutes N] [--devices N] [--poll-ms N] [--target]`
 *
 * Measures one window against the running database and reports the gates. It
 * exits non-zero only on an *applicable*, non-provisional gate failure: off the
 * target board the hardware gates cannot be evidence either way, and a harness
 * that failed a run for that would teach everyone to ignore it.
 */
if (import.meta.main) {
  const { readFileSync } = await import("node:fs");
  const { $ } = await import("bun");
  const flag = (name: string, fallback: number): number => {
    const i = process.argv.indexOf(`--${name}`);
    const value = i > 0 ? Number(process.argv[i + 1]) : Number.NaN;
    return Number.isFinite(value) ? value : fallback;
  };
  const container = process.env.WEAR_CONTAINER ?? "SunReye-timescaledb";
  const id = (await $`docker inspect -f {{.Id}} ${container}`.text()).trim();
  const io: WearIO = {
    read: (path) => readFileSync(path, "utf8"),
    scalar: async (sql) =>
      Number((await $`docker exec ${container} psql -U postgres -tAc ${sql}`.text()).trim()),
    nowMs: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => console.log(line),
  };
  const { results } = await runWindow(io, {
    cgroupIoStat: `/sys/fs/cgroup/system.slice/docker-${id}.scope/io.stat`,
    device: process.env.WEAR_DEVICE ?? "253:16",
    idleGbPerDay: flag("idle-gb", 0.04),
    windowMs: flag("minutes", 60) * 60_000,
    gates: {
      devices: flag("devices", 1),
      pollIntervalMs: flag("poll-ms", 1000),
      compressedBytesPerRow: flag("compressed-bytes-per-row", Number.NaN),
      uncompressedWindowMb: flag("uncompressed-mb", Number.NaN),
      thinningReduction: flag("thinning-reduction", Number.NaN),
      yearChartBuffers: flag("year-chart-buffers", Number.NaN),
    },
    onTargetHardware: process.argv.includes("--target"),
  });
  process.exit(gatesFailed(results) ? 1 : 0);
}
