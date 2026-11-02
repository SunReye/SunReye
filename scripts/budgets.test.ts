import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { main } from "./budget-gate";

import {
  WARMUP_LOGINS,
  growthOf,
  judge,
  parseArgs,
  parseBudgets,
  parseProcStatus,
  render,
  type Measured,
  type Sample,
} from "./budgets-plan";

const MIB = 1024 * 1024;

const budgets = { residentMiB: 32, binaryMiB: 25, growthKiB: 512 };

/** A `/proc/<pid>/status` as Linux writes it, with the two lines the harness reads. */
const status = (rssKiB: number, peakKiB: number) =>
  [
    "Name:\tsunreye",
    "VmPeak:\t  900000 kB",
    `VmHWM:\t${String(peakKiB).padStart(8)} kB`,
    `VmRSS:\t${String(rssKiB).padStart(8)} kB`,
    "Threads:\t3",
  ].join("\n");

const samples = (rssMiB: number[], stepMs = 100): Sample[] =>
  rssMiB.map((mib, i) => ({ atMs: i * stepMs, rssBytes: mib * MIB }));

describe("budgets.json", () => {
  test("is the one place the numbers live", () => {
    const parsed = parseBudgets(readFileSync("scripts/budgets.json", "utf8"));
    expect(Object.keys(parsed).sort()).toEqual(["binaryMiB", "growthKiB", "residentMiB"]);
  });

  test("a missing, zero, negative or non-numeric budget is refused, naming it", () => {
    for (const bad of [
      { ...budgets, binaryMiB: undefined },
      { ...budgets, residentMiB: 0 },
      { ...budgets, growthKiB: -1 },
      { ...budgets, binaryMiB: "25" },
    ]) {
      expect(() => parseBudgets(JSON.stringify(bad))).toThrow(/binaryMiB|residentMiB|growthKiB/);
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

describe("growth", () => {
  test("is the steady window minus the first, after the warm-up logins", () => {
    // 3 warm-up readings at 20 MiB, then 8 readings: first quarter 24, last quarter 26.
    const rss = [20, 20, 20, 24, 24, 25, 25, 25, 25, 26, 26];
    const out = growthOf(samples(rss), 3);
    expect(out.startBytes).toBe(24 * MIB);
    expect(out.steadyBytes).toBe(26 * MIB);
    expect(out.growthBytes).toBe(2 * MIB);
  });

  test("a flat series grows by nothing", () => {
    const out = growthOf(samples([28, 28, 28, 28, 28, 28, 28, 28]), 2);
    expect(out.growthBytes).toBe(0);
    expect(out.growthPerHourBytes).toBe(0);
  });

  test("one outlier reading does not move the steady value: windows use the median", () => {
    const out = growthOf(samples([28, 28, 28, 28, 28, 28, 28, 28, 28, 40, 28, 28]), 0);
    expect(out.steadyBytes).toBe(28 * MIB);
    expect(out.growthBytes).toBe(0);
  });

  test("extrapolates per hour from the time between the two windows", () => {
    // 8 readings 1 s apart: windows of 2, centred 0.5 s and 6.5 s: 1 MiB over 6 s.
    const out = growthOf(samples([10, 10, 10, 10, 10, 10, 11, 11], 1000), 0);
    expect(out.growthBytes).toBe(1 * MIB);
    expect(out.growthPerHourBytes).toBeCloseTo((1 * MIB * 3600) / 6, 0);
  });

  test("too few readings after the warm-up is refused, not read as no growth", () => {
    expect(() => growthOf(samples([28, 28, 28]), 2)).toThrow(/readings/);
  });
});

const measured = (over: Partial<Measured> = {}): Measured => ({
  binaryBytes: 18 * MIB,
  steadyBytes: 28 * MIB,
  peakBytes: 29 * MIB,
  startBytes: 28 * MIB,
  growthBytes: 0,
  growthPerHourBytes: 0,
  logins: 40,
  requests: 12,
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

  test("growth over the budget fails even when resident memory is inside it", () => {
    const failures = judge(measured({ growthBytes: 513 * 1024 }), budgets);
    expect(failures).toEqual([expect.stringContaining("growth")]);
  });

  test("every broken budget is named, not only the first", () => {
    const failures = judge(
      measured({ binaryBytes: 30 * MIB, steadyBytes: 40 * MIB, growthBytes: 10 * MIB }),
      budgets,
    );
    expect(failures).toHaveLength(3);
  });

  test("a soak that never polled the simulator proves nothing", () => {
    expect(judge(measured({ requests: 0 }), budgets)).toEqual([expect.stringContaining("polled")]);
  });

  test("the peak alone is reported, never judged", () => {
    expect(judge(measured({ peakBytes: 90 * MIB }), budgets)).toEqual([]);
  });
});

describe("the report", () => {
  test("states each figure beside its budget, in MiB", () => {
    const text = render(
      measured({
        binaryBytes: Math.round(18.4 * MIB),
        steadyBytes: Math.round(27.9 * MIB),
        peakBytes: Math.round(28.3 * MIB),
        growthBytes: 100 * 1024,
        growthPerHourBytes: 36 * MIB,
      }),
      budgets,
    );
    expect(text).toContain("binary    18.4 MiB of 25 MiB");
    expect(text).toContain("resident  27.9 MiB steady of 32 MiB, 28.3 MiB peak");
    expect(text).toContain(
      "growth    +100 KiB of 512 KiB over 40 logins, +36.0 MiB/h extrapolated",
    );
    expect(text).toContain("polled    12 requests");
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
  test("ADR 0006 points at budgets.json and states no number of its own", () => {
    const adr = readFileSync("docs/adr/0006-one-dependency-set-for-every-target.md", "utf8");
    expect(adr).toContain("scripts/budgets.json");
    expect(adr).not.toMatch(/≤\s*\d+\s*MB/);
  });

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
