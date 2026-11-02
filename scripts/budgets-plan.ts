/**
 * What the budget gate decides without a running core: the budgets file, the memory lines of
 * `/proc/<pid>/status`, growth over a soak and the verdict. `./budget-gate.ts` is the command,
 * `./budgets-run.ts` the build and the soak.
 *
 * Every figure is a byte count after a fixed number of operations. Nothing here reads a clock to
 * decide a verdict; elapsed time only scales the extrapolated report line.
 */

const MIB = 1024 * 1024;
const KIB = 1024;
const HOUR_MS = 3_600_000;

/** Logins before readings count: the first one allocates the Argon2 buffer. */
export const WARMUP_LOGINS = 10;
/** The soak `scripts/ci` runs; a long soak passes `--logins`. */
const DEFAULT_LOGINS = 60;

export const HELP = `usage: bun scripts/budget-gate.ts [--logins <n>]

Builds the release binary, fails when it is over its size budget, then signs in <n> times (default
${DEFAULT_LOGINS}) while it polls the simulator and fails when resident memory or its growth is over budget.
A long soak: --logins 100000.`;

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

export type Budgets = { residentMiB: number; binaryMiB: number; growthKiB: number };

const BUDGET_KEYS = ["residentMiB", "binaryMiB", "growthKiB"] as const;

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
    growthKiB: raw.growthKiB,
  } as Budgets;
}

const kibLine = (text: string, key: string): number => {
  const match = new RegExp(`^${key}:\\s*(\\d+) kB`, "m").exec(text);
  if (!match) throw new Error(`/proc status has no ${key} line`);
  return Number(match[1]) * KIB;
};

/** Resident set and its high-water mark, in bytes. */
export function parseProcStatus(text: string): { rssBytes: number; peakBytes: number } {
  return { rssBytes: kibLine(text, "VmRSS"), peakBytes: kibLine(text, "VmHWM") };
}

/** Resident bytes read right after a login, `atMs` after the soak began. */
export type Sample = { atMs: number; rssBytes: number };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

export type Growth = {
  startBytes: number;
  steadyBytes: number;
  growthBytes: number;
  growthPerHourBytes: number;
};

/**
 * Compares the first and the last quarter of the readings once `warmup` logins are past. Medians
 * keep one allocator spike from reading as growth or as a high steady value.
 */
export function growthOf(samples: Sample[], warmup: number): Growth {
  const after = samples.slice(warmup);
  if (after.length < 2) throw new Error(`${after.length} readings after warm-up, need at least 2`);
  const size = Math.max(1, after.length >> 2);
  const first = after.slice(0, size);
  const last = after.slice(-size);
  const startBytes = median(first.map((s) => s.rssBytes));
  const steadyBytes = median(last.map((s) => s.rssBytes));
  const growthBytes = steadyBytes - startBytes;
  const spanMs = mean(last.map((s) => s.atMs)) - mean(first.map((s) => s.atMs));
  const growthPerHourBytes = spanMs > 0 ? (growthBytes * HOUR_MS) / spanMs : 0;
  return { startBytes, steadyBytes, growthBytes, growthPerHourBytes };
}

export type Measured = Growth & {
  binaryBytes: number;
  peakBytes: number;
  logins: number;
  /** Modbus requests the simulator answered during the soak. */
  requests: number;
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
      m.growthBytes > budgets.growthKiB * KIB,
      `growth ${signedKiB(m.growthBytes)} over ${m.logins} logins exceeds ${budgets.growthKiB} KiB`,
    ],
    [m.requests === 0, "the simulator was never polled: the soak ran without a device"],
  ];
  return checks.filter(([broken]) => broken).map(([, message]) => message);
}

const mib = (bytes: number) => `${(bytes / MIB).toFixed(1)} MiB`;

const signedKiB = (bytes: number) =>
  `${bytes < 0 ? "-" : "+"}${Math.round(Math.abs(bytes) / KIB)} KiB`;

const signedMiB = (bytes: number) => `${bytes < 0 ? "-" : "+"}${mib(Math.abs(bytes))}`;

/** The figures beside their budgets, for the gate log. */
export function render(m: Measured, budgets: Budgets): string {
  return [
    `binary    ${mib(m.binaryBytes)} of ${budgets.binaryMiB} MiB`,
    `resident  ${mib(m.steadyBytes)} steady of ${budgets.residentMiB} MiB, ${mib(m.peakBytes)} peak`,
    `growth    ${signedKiB(m.growthBytes)} of ${budgets.growthKiB} KiB over ${m.logins} logins, ` +
      `${signedMiB(m.growthPerHourBytes)}/h extrapolated`,
    `polled    ${m.requests} requests`,
  ].join("\n");
}
