import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { main } from "./budget-gate";

import {
  CycleCounter,
  POLL_READINGS,
  POLL_SAMPLES,
  POLL_WARMUP,
  WARMUP_LOGINS,
  judge,
  parseArgs,
  parseBudgets,
  parseProcStatus,
  parseSimLine,
  pollPhase,
  render,
  trendOf,
  type Measured,
} from "./budgets-plan";

const MIB = 1024 * 1024;

const KIB = 1024;

const budgets = { residentMiB: 32, binaryMiB: 25, growthKiBPerLogin: 16, growthKiBPerPoll: 32 };

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
  test("a reading series climbing 1 MiB per operation has a slope of 1 MiB", () => {
    const out = trendOf(
      [10, 11, 12, 13, 14].map((mib) => mib * MIB),
      0,
    );
    expect(out.bytesPerOp).toBe(1 * MIB);
  });

  test("a leak of 128 KiB per operation reads as 128 KiB under the allocator's noise", () => {
    // 28 MiB flat plus 128 KiB per operation, the readings 0-4 KiB off.
    const noise = [0, 4, -4, 0, 4, 0, -4, 4];
    const rss = noise.map((n, i) => 28 * MIB + i * 128 * KIB + n * KIB);
    expect(trendOf(rss, 0).bytesPerOp / KIB).toBeCloseTo(128, 0);
  });

  test("a flat series gains nothing", () => {
    const out = trendOf(Array<number>(8).fill(28 * MIB), 2);
    expect(out.bytesPerOp).toBe(0);
    expect(out.steadyBytes).toBe(28 * MIB);
  });

  test("a shrinking series has a negative slope", () => {
    expect(
      trendOf(
        [30, 29, 28, 27].map((mib) => mib * MIB),
        0,
      ).bytesPerOp,
    ).toBe(-1 * MIB);
  });

  test("the warm-up readings are left out of the slope", () => {
    // 20 MiB while warming up, then flat at 28 MiB.
    const rss = [20, 24, 28, 28, 28, 28].map((mib) => mib * MIB);
    expect(trendOf(rss, 2).bytesPerOp).toBe(0);
  });

  test("the steady value is the median of the last quarter: one spike does not move it", () => {
    const rss = [28, 28, 28, 28, 28, 28, 28, 28, 28, 40, 28, 28].map((mib) => mib * MIB);
    expect(trendOf(rss, 0).steadyBytes).toBe(28 * MIB);
  });

  test("too few readings after the warm-up is refused, not read as no growth", () => {
    expect(() => trendOf([28 * MIB, 28 * MIB, 28 * MIB], 2)).toThrow(/readings/);
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
    expect(run([100, 120, 140])).toEqual({ began: [false, false, false], completed: 0 });
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

/** The poll phase as the soak reads it: `POLL_WARMUP` readings, then `POLL_READINGS` that are fitted. */
const pollSeries = (warm: (i: number) => number, fitted: (i: number) => number) =>
  Array.from({ length: POLL_SAMPLES }, (_, i) =>
    i < POLL_WARMUP ? warm(i) : fitted(i - POLL_WARMUP),
  );

describe("the poll phase", () => {
  const verdict = (rss: number[]) => {
    const phase = pollPhase(rss);
    return judge(measured({ polls: phase.polls, pollBytesPerOp: phase.bytesPerOp }), budgets);
  };

  test("a one-time step on the last warm-up reading is not a per-poll leak", () => {
    const rss = pollSeries(
      (i) => (i === POLL_WARMUP - 1 ? 31 * MIB : 30 * MIB),
      () => 31 * MIB,
    );
    expect(pollPhase(rss).bytesPerOp).toBe(0);
    expect(verdict(rss)).toEqual([]);
  });

  test("a steady leak of 128 KiB per poll after the step still fails", () => {
    const rss = pollSeries(
      (i) => (i < POLL_WARMUP - 1 ? 30 * MIB : 31 * MIB),
      (i) => 31 * MIB + i * 128 * KIB,
    );
    expect(verdict(rss)).toEqual([expect.stringContaining("+128.0 KiB/poll")]);
  });

  test("a leak that runs through the warm-up too still fails", () => {
    const rss = Array.from({ length: POLL_SAMPLES }, (_, i) => 30 * MIB + i * 128 * KIB);
    expect(verdict(rss)).toEqual([expect.stringContaining("+128.0 KiB/poll")]);
  });

  test("the fit covers the readings after the warm-up, and the steady value is theirs", () => {
    const rss = pollSeries(
      () => 40 * MIB,
      () => 29 * MIB,
    );
    expect(pollPhase(rss)).toEqual({ polls: POLL_READINGS, bytesPerOp: 0, steadyBytes: 29 * MIB });
  });

  test("a soak that ended inside the warm-up is refused, not read as no growth", () => {
    expect(() => pollPhase(Array<number>(POLL_WARMUP + 1).fill(30 * MIB))).toThrow(/readings/);
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
    expect(parseArgs([])).toEqual({ help: false, logins: 60 });
    expect(parseArgs(["--logins", "100000"])).toEqual({ help: false, logins: 100_000 });
    expect(parseArgs(["--help"]).help).toBe(true);
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
