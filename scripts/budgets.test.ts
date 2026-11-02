import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { main } from "./budget-gate";

import {
  CycleCounter,
  LOGIN_READINGS,
  POLL_READINGS,
  POLL_SAMPLES,
  WARMUP_LOGINS,
  judge,
  loginPhase,
  parseArgs,
  parseBudgets,
  parseProcStatus,
  parseSimLine,
  pollPhase,
  render,
  type Measured,
} from "./budgets-plan";

const MIB = 1024 * 1024;

const KIB = 1024;

const budgets = {
  residentMiB: 32,
  binaryMiB: 25,
  growthKiBPerLogin: 16,
  growthKiBPerPoll: 32,
};

/** A `/proc/<pid>/status` as Linux writes it, with the two lines the harness reads. */
const status = (rssKiB: number, peakKiB: number) =>
  [
    "Name:\tsunreye",
    "VmPeak:\t  900000 kB",
    `VmHWM:\t${String(peakKiB).padStart(8)} kB`,
    `VmRSS:\t${String(rssKiB).padStart(8)} kB`,
    "Threads:\t3",
  ].join("\n");

describe("budgets.json", () => {
  test("is the one place the numbers live", () => {
    const parsed = parseBudgets(readFileSync("scripts/budgets.json", "utf8"));
    expect(Object.keys(parsed).sort()).toEqual([
      "binaryMiB",
      "growthKiBPerLogin",
      "growthKiBPerPoll",
      "residentMiB",
    ]);
  });

  test("a missing, zero, negative or non-numeric budget is refused, naming it", () => {
    for (const bad of [
      { ...budgets, binaryMiB: undefined },
      { ...budgets, residentMiB: 0 },
      { ...budgets, growthKiBPerPoll: -1 },
      { ...budgets, growthKiBPerLogin: 0 },
      { ...budgets, binaryMiB: "25" },
    ]) {
      expect(() => parseBudgets(JSON.stringify(bad))).toThrow(/binaryMiB|residentMiB|growthKiBPer/);
    }
  });
});

describe("reading /proc/<pid>/status", () => {
  test("converts the kB lines to bytes", () => {
    expect(parseProcStatus(status(28_672, 29_696))).toEqual({
      rssBytes: 28_672 * 1024,
      peakBytes: 29_696 * 1024,
    });
  });

  test("a status without the memory lines is refused", () => {
    expect(() => parseProcStatus("Name:\tsunreye\nThreads:\t3")).toThrow(/VmRSS/);
    expect(() => parseProcStatus(`VmRSS:\t1 kB`)).toThrow(/VmHWM/);
  });
});

describe("the trend of a phase", () => {
  /** The fit over `after`, read past 120 warm-up cycles that hold 0 bytes. */
  const fit = (after: number[]) => pollPhase([...Array<number>(120).fill(0), ...after]);

  test("a reading series climbing 1 MiB per operation has a slope of 1 MiB", () => {
    expect(fit([10, 11, 12, 13, 14].map((mib) => mib * MIB)).bytesPerOp).toBe(1 * MIB);
  });

  test("a leak of 128 KiB per operation reads as 128 KiB under the allocator's noise", () => {
    // 28 MiB flat plus 128 KiB per operation, the readings 0-4 KiB off.
    const noise = [0, 4, -4, 0, 4, 0, -4, 4];
    const rss = noise.map((n, i) => 28 * MIB + i * 128 * KIB + n * KIB);
    expect(fit(rss).bytesPerOp / KIB).toBeCloseTo(128, 0);
  });

  test("a flat series gains nothing", () => {
    const out = fit(Array<number>(8).fill(28 * MIB));
    expect(out.bytesPerOp).toBe(0);
    expect(out.steadyBytes).toBe(28 * MIB);
  });

  test("a shrinking series has a negative slope", () => {
    expect(fit([30, 29, 28, 27].map((mib) => mib * MIB)).bytesPerOp).toBe(-1 * MIB);
  });

  test("the steady value is the median of the last quarter: one spike does not move it", () => {
    const rss = [28, 28, 28, 28, 28, 28, 28, 28, 28, 40, 28, 28].map((mib) => mib * MIB);
    expect(fit(rss).steadyBytes).toBe(28 * MIB);
  });
});

describe("the simulator's stdout", () => {
  test("names the port it listens on and the start of each request", () => {
    expect(parseSimLine("listening 127.0.0.1:41233")).toEqual({ port: 41233 });
    expect(parseSimLine("request 98 1")).toEqual({ start: 98 });
    expect(parseSimLine("request 0 0")).toEqual({ start: 0 });
  });

  test("any other line says nothing", () => {
    for (const line of ["", "requests 4", "request 98", "listening", "listening 127.0.0.1:x"]) {
      expect(parseSimLine(line)).toBeUndefined();
    }
  });
});

describe("telling poll cycles apart", () => {
  // A poll reads its blocks in a fixed order; the first block's address opens each cycle.
  const run = (starts: number[]) => {
    const counter = new CycleCounter();
    const began = starts.map((start) => counter.record(start));
    return { began, completed: counter.completed };
  };

  test("a request for the first address after the first request ends the cycle before it", () => {
    expect(run([100, 120, 140, 100, 120, 140, 100])).toEqual({
      began: [false, false, false, true, false, false, true],
      completed: 2,
    });
  });

  test("the cycle in progress is not counted, nor is a lone request", () => {
    expect(run([100])).toEqual({ began: [false], completed: 0 });
    expect(run([100, 120, 140])).toEqual({
      began: [false, false, false],
      completed: 0,
    });
  });

  test("a block read again under another address is not a new cycle", () => {
    expect(run([100, 120, 120, 140, 100]).completed).toBe(1);
  });
});

const measured = (over: Partial<Measured> = {}): Measured => ({
  binaryBytes: 18 * MIB,
  steadyBytes: 28 * MIB,
  peakBytes: 29 * MIB,
  logins: 40,
  loginBytesPerOp: 0,
  polls: POLL_READINGS,
  pollBytesPerOp: 0,
  ...over,
});

describe("judging a run against the budgets", () => {
  test("a run inside every budget passes", () => {
    expect(judge(measured(), budgets)).toEqual([]);
  });

  test("a figure exactly at its budget passes; a byte over fails", () => {
    expect(judge(measured({ binaryBytes: 25 * MIB, steadyBytes: 32 * MIB }), budgets)).toEqual([]);
    expect(judge(measured({ binaryBytes: 25 * MIB + 1 }), budgets)).toEqual([
      expect.stringContaining("binary"),
    ]);
    expect(judge(measured({ steadyBytes: 32 * MIB + 1 }), budgets)).toEqual([
      expect.stringContaining("resident"),
    ]);
  });

  test("growth per login exactly at its budget passes; a byte over fails", () => {
    expect(judge(measured({ loginBytesPerOp: 16 * KIB }), budgets)).toEqual([]);
    expect(judge(measured({ loginBytesPerOp: 16 * KIB + 1 }), budgets)).toEqual([
      expect.stringContaining("/login"),
    ]);
  });

  test("growth per poll exactly at its budget passes; a byte over fails", () => {
    expect(judge(measured({ pollBytesPerOp: 32 * KIB }), budgets)).toEqual([]);
    expect(judge(measured({ pollBytesPerOp: 32 * KIB + 1 }), budgets)).toEqual([
      expect.stringContaining("/poll"),
    ]);
  });

  test("a leak of 128 KiB per poll fails with resident memory still inside its budget", () => {
    const failures = judge(measured({ pollBytesPerOp: 128 * KIB }), budgets);
    expect(failures).toEqual([expect.stringContaining("+128.0 KiB/poll")]);
  });

  test("shrinking is not growth", () => {
    expect(judge(measured({ loginBytesPerOp: -KIB, pollBytesPerOp: -KIB }), budgets)).toEqual([]);
  });

  test("every broken budget is named, not only the first", () => {
    const failures = judge(
      measured({
        binaryBytes: 30 * MIB,
        steadyBytes: 40 * MIB,
        loginBytesPerOp: MIB,
        pollBytesPerOp: MIB,
      }),
      budgets,
    );
    expect(failures).toHaveLength(4);
  });

  test("a soak that read fewer poll cycles than it needs proves nothing", () => {
    expect(judge(measured({ polls: POLL_READINGS - 1 }), budgets)).toEqual([
      expect.stringContaining("poll cycles read"),
    ]);
  });

  test("the peak alone is reported, never judged", () => {
    expect(judge(measured({ peakBytes: 90 * MIB }), budgets)).toEqual([]);
  });
});

/** The soak's poll readings: one per cycle from the end of the logins, `POLL_SAMPLES` of them. */
const pollSoak = (rssAtCycle: (cycle: number) => number) =>
  Array.from({ length: POLL_SAMPLES }, (_, cycle) => rssAtCycle(cycle));

/**
 * A booted core's poll phase as measured: one-time steps of 0.3 to 1 MiB, the last at cycle 117,
 * flat after.
 */
const bootSteps: [cycle: number, kib: number][] = [
  [2, 1024],
  [9, 600],
  [31, 350],
  [64, 500],
  [105, 300],
  [117, 350],
];
const bootShape = (cycle: number) =>
  30 * MIB + bootSteps.filter(([at]) => cycle >= at).reduce((sum, [, kib]) => sum + kib * KIB, 0);

describe("the poll phase", () => {
  const verdict = (rss: number[]) => {
    const phase = pollPhase(rss);
    return judge(measured({ polls: phase.polls, pollBytesPerOp: phase.bytesPerOp }), budgets);
  };

  test("the measured boot steps, the last at cycle 117, read as no growth", () => {
    const phase = pollPhase(pollSoak(bootShape));
    expect(phase.bytesPerOp).toBe(0);
    expect(phase.steadyBytes).toBe(30 * MIB + 3124 * KIB);
  });

  test("a one-time step on cycle 119 is not a per-poll leak", () => {
    const rss = pollSoak((cycle) => (cycle >= 119 ? 31 * MIB : 30 * MIB));
    expect(pollPhase(rss).bytesPerOp).toBe(0);
    expect(verdict(rss)).toEqual([]);
  });

  test("a 350 KiB step at cycle 124 is a small slope, not the +66 KiB/poll of an 8-cycle fit", () => {
    const rss = pollSoak((cycle) => bootShape(cycle) + (cycle >= 124 ? 350 * KIB : 0));
    expect(pollPhase(rss).bytesPerOp / KIB).toBeLessThan(16);
    expect(verdict(rss)).toEqual([]);
  });

  test("a steady leak of 128 KiB per poll from cycle 120 still fails", () => {
    const rss = pollSoak((cycle) => bootShape(cycle) + Math.max(0, cycle - 120) * 128 * KIB);
    expect(verdict(rss)).toEqual([expect.stringContaining("+128.0 KiB/poll")]);
  });

  test("a leak that runs through the warm-up too still fails", () => {
    const rss = pollSoak((cycle) => 30 * MIB + cycle * 128 * KIB);
    expect(verdict(rss)).toEqual([expect.stringContaining("+128.0 KiB/poll")]);
  });

  test("the fit covers the readings after the warm-up, and the steady value is theirs", () => {
    const rss = pollSoak((cycle) => (cycle < 120 ? 40 * MIB : 29 * MIB));
    expect(pollPhase(rss)).toEqual({
      polls: 32,
      bytesPerOp: 0,
      steadyBytes: 29 * MIB,
    });
  });

  test("a soak that ended inside the warm-up is refused, not read as no growth", () => {
    expect(() => pollPhase(Array<number>(121).fill(30 * MIB))).toThrow(/readings/);
  });
});

/** A booted core's logins as measured: 35 KiB each over the first 60, then 2.5 KiB each. */
const loginShape = (login: number) =>
  28 * MIB + Math.min(login, 60) * 35 * KIB + Math.max(0, login - 60) * 2.5 * KIB;

describe("the login phase", () => {
  const loginSoak = (rssAtLogin: (login: number) => number) =>
    Array.from({ length: parseArgs([]).logins }, (_, i) => rssAtLogin(i + 1));

  test("the early growth of the first 60 logins is left out: the default soak reads 2.5 KiB/login", () => {
    expect(loginPhase(loginSoak(loginShape)).bytesPerOp / KIB).toBeCloseTo(2.5, 3);
  });

  test("a leak of 32 KiB per login past the warm-up still fails", () => {
    const phase = loginPhase(loginSoak((login) => loginShape(login) + login * 32 * KIB));
    expect(judge(measured({ loginBytesPerOp: phase.bytesPerOp }), budgets)).toEqual([
      expect.stringContaining("+34.5 KiB/login"),
    ]);
  });
});

describe("the report", () => {
  test("states each figure beside its budget, in MiB", () => {
    const text = render(
      measured({
        binaryBytes: Math.round(18.4 * MIB),
        steadyBytes: Math.round(27.9 * MIB),
        peakBytes: Math.round(28.3 * MIB),
        loginBytesPerOp: 4.25 * KIB,
        logins: 40,
        pollBytesPerOp: -0.5 * KIB,
        polls: 8,
      }),
      budgets,
    );
    expect(text).toContain("binary    18.4 MiB of 25 MiB");
    expect(text).toContain("resident  27.9 MiB steady of 32 MiB, 28.3 MiB peak");
    expect(text).toContain("growth    +4.3 KiB/login of 16 KiB over 40 logins");
    expect(text).toContain("growth    -0.5 KiB/poll of 32 KiB over 8 poll cycles");
  });
});

describe("command line", () => {
  test("runs the short soak by default and a longer one on request", () => {
    expect(parseArgs([])).toEqual({ help: false, logins: 400 });
    expect(parseArgs(["--logins", "100000"])).toEqual({
      help: false,
      logins: 100_000,
    });
    expect(parseArgs(["--help"]).help).toBe(true);
  });

  test("the default soak leaves a full window of logins to fit after the warm-up", () => {
    expect(parseArgs([]).logins - WARMUP_LOGINS).toBeGreaterThanOrEqual(LOGIN_READINGS);
  });

  test("a login count that leaves no reading after the warm-up is refused", () => {
    for (const bad of ["0", "-5", "abc", "1.5", String(WARMUP_LOGINS + 1)]) {
      expect(() => parseArgs(["--logins", bad])).toThrow(/--logins/);
    }
    expect(() => parseArgs(["--logins"])).toThrow(/--logins/);
  });

  test("an unknown argument is refused, naming it", () => {
    expect(() => parseArgs(["--hours", "2"])).toThrow(/--hours/);
  });
});

describe("the command", () => {
  test("--help prints the usage and exits 0 without building anything", async () => {
    const printed: string[] = [];
    const real = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await main(["--help"])).toBe(0);
    } finally {
      console.log = real;
    }
    expect(printed.join("\n")).toContain("usage: bun scripts/budget-gate.ts");
  });

  test("a bad argument exits 1 naming it, before anything builds", async () => {
    const printed: string[] = [];
    const real = console.error;
    console.error = (line: string) => printed.push(line);
    try {
      expect(await main(["--hours", "2"])).toBe(1);
    } finally {
      console.error = real;
    }
    expect(printed.join("\n")).toContain("--hours");
  });
});

describe("where the budgets are held", () => {
  test("scripts/ci runs the budgets after the SPA can be built and before it is green", () => {
    const ci = readFileSync("scripts/ci", "utf8");
    const lines = ci.split("\n").map((l) => l.trim());
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(at("bun run test:budgets")).toBeGreaterThan(at("bun run build"));
    expect(at("bun run test:budgets")).toBeLessThan(at('step "ci green"'));
    expect(lines[at("bun run test:budgets")]).not.toContain("||");
  });

  test("bun run test:budgets is the harness command", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["test:budgets"]).toBe("bun scripts/budget-gate.ts");
  });
});
