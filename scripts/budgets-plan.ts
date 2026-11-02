/**
 * What the budget gate decides without a running core: the budgets file, the memory lines of
 * `/proc/<pid>/status`, growth over a soak and the verdict. `./budget-gate.ts` is the command,
 * `./budgets-run.ts` the build and the soak.
 *
 * Every figure is a byte count per operation: per login, per poll cycle. Nothing here reads a
 * clock, so a loaded machine changes how long the soak takes and never its verdict.
 */

const MIB = 1024 * 1024;
const KIB = 1024;

/** Logins not fitted: early ones grow 20 to 50 KiB each over the first 60, later ones about 2.5 KiB. */
export const WARMUP_LOGINS = 100;
/** Resident readings, one per login, fitted after the warm-up: a window long enough that one step is a small slope. */
export const LOGIN_READINGS = 300;
/** Poll cycles not fitted: boot steps of 0.3 to 1 MiB were measured up to cycle 117. */
export const POLL_WARMUP = 120;
/** Poll readings fitted: a one-time step of S reads as at most 3S/(2n) per poll over n readings. */
export const POLL_READINGS = 32;
/** Readings the poll phase takes in all. */
export const POLL_SAMPLES = POLL_WARMUP + POLL_READINGS;
/** The soak `scripts/ci` runs; a long soak passes `--logins`. */
const DEFAULT_LOGINS = WARMUP_LOGINS + LOGIN_READINGS;

export const HELP = `usage: bun scripts/budget-gate.ts [--logins <n>]

Builds the release binary, fails when it is over its size budget, signs in <n> times (default
${DEFAULT_LOGINS}) and then holds for ${POLL_SAMPLES} poll cycles of the simulator. Fails when resident memory,
or its growth per login or per poll cycle, is over budget. A long soak: --logins 100000.`;

export type Args = { help: boolean; logins: number };

/** The soak must leave at least two readings after the warm-up. */
export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { help: false, logins: DEFAULT_LOGINS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help") args.help = true;
    else if (arg === "--logins") args.logins = readLogins(argv[++i]);
    else throw new Error(`unknown argument ${String(arg)}\n${HELP}`);
  }
  return args;
}

function readLogins(value: string | undefined): number {
  const logins = Number(value);
  if (!Number.isInteger(logins) || logins < WARMUP_LOGINS + 2) {
    throw new Error(
      `--logins needs a whole number of at least ${WARMUP_LOGINS + 2}, got ${String(value)}`,
    );
  }
  return logins;
}

export type Budgets = {
  residentMiB: number;
  binaryMiB: number;
  growthKiBPerLogin: number;
  growthKiBPerPoll: number;
};

const BUDGET_KEYS = ["residentMiB", "binaryMiB", "growthKiBPerLogin", "growthKiBPerPoll"] as const;

/** `scripts/budgets.json`: each budget a positive number. */
export function parseBudgets(text: string): Budgets {
  const raw = JSON.parse(text) as Record<string, unknown>;
  for (const key of BUDGET_KEYS) {
    const value = raw[key];
    if (typeof value !== "number" || !(value > 0)) {
      throw new Error(
        `scripts/budgets.json: ${key} must be a positive number, got ${String(value)}`,
      );
    }
  }
  return {
    residentMiB: raw.residentMiB,
    binaryMiB: raw.binaryMiB,
    growthKiBPerLogin: raw.growthKiBPerLogin,
    growthKiBPerPoll: raw.growthKiBPerPoll,
  } as Budgets;
}

const kibLine = (text: string, key: string): number => {
  const match = new RegExp(`^${key}:\\s*(\\d+) kB`, "m").exec(text);
  if (!match) throw new Error(`/proc status has no ${key} line`);
  return Number(match[1]) * KIB;
};

/** Resident set and its high-water mark, in bytes. */
export function parseProcStatus(text: string): {
  rssBytes: number;
  peakBytes: number;
} {
  return {
    rssBytes: kibLine(text, "VmRSS"),
    peakBytes: kibLine(text, "VmHWM"),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export type Trend = {
  /** Median of the last quarter of the readings. */
  steadyBytes: number;
  /** Least-squares slope: bytes gained per operation, one reading per operation. */
  bytesPerOp: number;
};

/**
 * What the resident readings of one phase say once `warmup` readings are past. The median of the
 * last quarter keeps one allocator spike from reading as a high steady value; the slope uses
 * every reading, so a leak of any size per operation shows however the run is paced.
 */
function trendOf(readings: number[], warmup: number): Trend {
  const after = readings.slice(warmup);
  if (after.length < 2) throw new Error(`${after.length} readings after warm-up, need at least 2`);
  const meanIndex = (after.length - 1) / 2;
  const meanBytes = after.reduce((sum, v) => sum + v, 0) / after.length;
  let covariance = 0;
  let variance = 0;
  after.forEach((bytes, i) => {
    covariance += (i - meanIndex) * (bytes - meanBytes);
    variance += (i - meanIndex) ** 2;
  });
  const size = Math.max(1, after.length >> 2);
  return {
    steadyBytes: median(after.slice(-size)),
    bytesPerOp: covariance / variance,
  };
}

/** The login phase: the fit over the readings after `WARMUP_LOGINS`. */
export function loginPhase(readings: number[]): Trend {
  return trendOf(readings, WARMUP_LOGINS);
}

/** The poll phase: the fit over the readings after `POLL_WARMUP`, and how many it covered. */
export function pollPhase(readings: number[]): Trend & { polls: number } {
  return {
    ...trendOf(readings, POLL_WARMUP),
    polls: readings.length - POLL_WARMUP,
  };
}

/** A line of `sunreye-sim` stdout: the port it listens on, or the start address of a request. */
export function parseSimLine(line: string): { port: number } | { start: number } | undefined {
  const port = /^listening .*:(\d+)$/.exec(line)?.[1];
  if (port) return { port: Number(port) };
  const start = /^request (\d+) \d+$/.exec(line)?.[1];
  return start ? { start: Number(start) } : undefined;
}

/**
 * Tells poll cycles apart in the requests the simulator answers. A poll reads its blocks in a
 * fixed order, so each request for the first block's address starts the next cycle.
 */
export class CycleCounter {
  #first: number | undefined;
  /** Cycles that have ended: the one in progress is not counted. */
  completed = 0;

  /** True when this request began a cycle, which means the one before it has ended. */
  record(start: number): boolean {
    if (this.#first === undefined) {
      this.#first = start;
      return false;
    }
    if (start !== this.#first) return false;
    this.completed++;
    return true;
  }
}

export type Measured = {
  binaryBytes: number;
  steadyBytes: number;
  peakBytes: number;
  logins: number;
  /** Bytes gained per login over the login phase. */
  loginBytesPerOp: number;
  /** Poll cycles read after the logins. */
  polls: number;
  /** Bytes gained per poll cycle over the poll phase. */
  pollBytesPerOp: number;
};

/** One line per broken budget; empty when the run is inside all of them. The peak is only reported. */
export function judge(m: Measured, budgets: Budgets): string[] {
  const checks: [boolean, string][] = [
    [
      m.binaryBytes > budgets.binaryMiB * MIB,
      `binary ${mib(m.binaryBytes)} exceeds ${budgets.binaryMiB} MiB`,
    ],
    [
      m.steadyBytes > budgets.residentMiB * MIB,
      `resident ${mib(m.steadyBytes)} steady exceeds ${budgets.residentMiB} MiB`,
    ],
    [
      m.loginBytesPerOp > budgets.growthKiBPerLogin * KIB,
      `growth ${signedKiB(m.loginBytesPerOp)}/login over ${m.logins} logins exceeds ${budgets.growthKiBPerLogin} KiB/login`,
    ],
    [
      m.pollBytesPerOp > budgets.growthKiBPerPoll * KIB,
      `growth ${signedKiB(m.pollBytesPerOp)}/poll over ${m.polls} poll cycles exceeds ${budgets.growthKiBPerPoll} KiB/poll`,
    ],
    [
      m.polls < POLL_READINGS,
      `${m.polls} poll cycles read, need ${POLL_READINGS}: the soak ran without a device`,
    ],
  ];
  return checks.filter(([broken]) => broken).map(([, message]) => message);
}

const mib = (bytes: number) => `${(bytes / MIB).toFixed(1)} MiB`;

const signedKiB = (bytes: number) =>
  `${bytes < 0 ? "-" : "+"}${(Math.abs(bytes) / KIB).toFixed(1)} KiB`;

/** The figures beside their budgets, for the gate log. */
export function render(m: Measured, budgets: Budgets): string {
  return [
    `binary    ${mib(m.binaryBytes)} of ${budgets.binaryMiB} MiB`,
    `resident  ${mib(m.steadyBytes)} steady of ${budgets.residentMiB} MiB, ${mib(m.peakBytes)} peak`,
    `growth    ${signedKiB(m.loginBytesPerOp)}/login of ${budgets.growthKiBPerLogin} KiB over ${m.logins} logins`,
    `growth    ${signedKiB(m.pollBytesPerOp)}/poll of ${budgets.growthKiBPerPoll} KiB over ${m.polls} poll cycles`,
  ].join("\n");
}
