import { describe, expect, test } from "bun:test";

import {
  GATES,
  LOAD_TOLERANCE,
  MIN_SAMPLES,
  WearMeasurementError,
  compareSamples,
  deviceLine,
  evaluateGates,
  formatGates,
  gatesFailed,
  measureWindow,
  parseIoStat,
  runWindow,
  type GateInputs,
  type WearSample,
  type WindowEnd,
} from "./storage-wear";

/** A cgroup v2 `io.stat`, in the shape the reference measurement was read from. */
const ioStat = (wbytes: number, device = "253:16") =>
  [
    "8:0 rbytes=4096 wbytes=0 rios=1 wios=0 dbytes=0 dios=0",
    `${device} rbytes=1048576 wbytes=${wbytes} rios=64 wios=999 dbytes=0 dios=0`,
  ].join("\n");

const end = (over: Partial<WindowEnd> & { atMs: number; ioStat: string }): WindowEnd => ({
  rows: 0,
  postgresBytes: 0,
  load1: 1,
  ...over,
});

const GB = 1_000_000_000;
const HOUR = 3_600_000;

describe("parsing io.stat", () => {
  test("reads the counters for one device and ignores the others", () => {
    expect(deviceLine(ioStat(12_345), "253:16")).toEqual({
      device: "253:16",
      rbytes: 1_048_576,
      wbytes: 12_345,
      rios: 64,
      wios: 999,
    });
  });

  test("a device the cgroup never touched is absent, not zero", () => {
    // Zero would read as "measured no writes"; absence is "did not measure".
    expect(deviceLine(ioStat(1), "254:0")).toBeUndefined();
  });

  test("tolerates fields this kernel version did not have", () => {
    // A harness that rejects a newer kernel is a harness nobody runs.
    const parsed = parseIoStat("253:16 rbytes=1 wbytes=2 rios=3 wios=4 future_field=9");
    expect(parsed[0]).toMatchObject({ wbytes: 2, wios: 4 });
  });

  test("ignores headers and blank lines rather than inventing a device", () => {
    expect(parseIoStat("\n# comment\n \n")).toEqual([]);
  });
});

describe("measuring a window", () => {
  const measure = (before: WindowEnd, after: WindowEnd, idleGbPerDay = 0) =>
    measureWindow(before, after, { device: "253:16", idleGbPerDay });

  test("derives GB/day from the counter delta and the window length", () => {
    const m = measure(
      end({ atMs: 0, ioStat: ioStat(0) }),
      end({ atMs: 24 * HOUR, ioStat: ioStat(3.39 * GB) }),
    );
    expect(m.gbPerDay).toBeCloseTo(3.39, 2);
  });

  test("scales a partial window to a daily rate", () => {
    // The reference measurement was an 18.03 h window, not a day.
    const m = measure(
      end({ atMs: 0, ioStat: ioStat(0) }),
      end({ atMs: 18.03 * HOUR, ioStat: ioStat(2.547 * GB) }),
    );
    expect(m.gbPerDay).toBeCloseTo(3.39, 1);
  });

  test("subtracts the idle baseline and still reports it", () => {
    // Folding it in makes a 1.2 % correction indistinguishable from the thing
    // being measured.
    const m = measure(
      end({ atMs: 0, ioStat: ioStat(0) }),
      end({ atMs: 24 * HOUR, ioStat: ioStat(1 * GB) }),
      0.04,
    );
    expect(m.gbPerDay).toBeCloseTo(0.96, 3);
    expect(m.idleGbPerDay).toBe(0.04);
  });

  test("write amplification is device bytes over what Postgres says it wrote", () => {
    const m = measure(
      end({ atMs: 0, ioStat: ioStat(0), postgresBytes: 0 }),
      end({ atMs: HOUR, ioStat: ioStat(16 * GB), postgresBytes: 1 * GB }),
    );
    expect(m.amplification).toBeCloseTo(16, 6);
  });

  test("a window in which Postgres wrote nothing has no ratio, not an infinite one", () => {
    const m = measure(end({ atMs: 0, ioStat: ioStat(0) }), end({ atMs: HOUR, ioStat: ioStat(GB) }));
    expect(Number.isNaN(m.amplification)).toBe(true);
  });

  test("counters going backwards is an error, not a negative rate", () => {
    // Monotonic per cgroup, so a decrease means the container was recreated and
    // the two ends describe different lifetimes.
    expect(() =>
      measure(end({ atMs: 0, ioStat: ioStat(5 * GB) }), end({ atMs: HOUR, ioStat: ioStat(GB) })),
    ).toThrow(WearMeasurementError);
  });

  test("a missing device is an error rather than a zero measurement", () => {
    expect(() =>
      measureWindow(
        end({ atMs: 0, ioStat: ioStat(0, "8:0") }),
        end({ atMs: HOUR, ioStat: ioStat(GB, "8:0") }),
        { device: "253:16", idleGbPerDay: 0 },
      ),
    ).toThrow(/absent from io.stat/);
  });

  test("ends out of order are rejected", () => {
    expect(() =>
      measure(end({ atMs: HOUR, ioStat: ioStat(0) }), end({ atMs: 0, ioStat: ioStat(GB) })),
    ).toThrow(WearMeasurementError);
  });

  test("carries the load the sample was taken under", () => {
    const m = measure(
      end({ atMs: 0, ioStat: ioStat(0), load1: 0.5 }),
      end({ atMs: HOUR, ioStat: ioStat(GB), load1: 1.5 }),
    );
    expect(m.load1).toBe(1);
  });

  test("rows per day comes from the row counter, not from the byte rate", () => {
    const m = measure(
      end({ atMs: 0, ioStat: ioStat(0), rows: 1000 }),
      end({ atMs: 12 * HOUR, ioStat: ioStat(GB), rows: 1_556_000 }),
    );
    expect(m.rowsPerDay).toBeCloseTo(3.11e6, -3);
  });
});

// --- the gates --------------------------------------------------------------

const passing: GateInputs = {
  gbPerDay: 0.3,
  idleGbPerDay: 0.04,
  rowsPerDay: 400_000,
  amplification: 3.5,
  load1: 1,
  windowMs: 24 * HOUR,
  devices: 1,
  pollIntervalMs: 1000,
  compressedBytesPerRow: 4.1,
  uncompressedWindowMb: 4,
  thinningReduction: 0.87,
  yearChartBuffers: 60,
};

describe("the gates", () => {
  test("the reference baseline fails the gates it is supposed to fail", () => {
    // 3.39 GB/day at 16x amplification is the thing being fixed; a harness that
    // passed it would be measuring the wrong quantity.
    const baseline: GateInputs = {
      ...passing,
      gbPerDay: 3.39,
      amplification: 16,
      uncompressedWindowMb: 1011,
      thinningReduction: 0,
      yearChartBuffers: 8760,
    };
    const failed = evaluateGates(baseline, true)
      .filter((r) => r.applicable && !r.passed)
      .map((r) => r.gate.id);
    expect(failed).toEqual([1, 3, 5, 6, 7]);
  });

  test("every applicable gate passes on a measurement that meets all thresholds", () => {
    // No single run can pass every gate: gate 2 is stated for five devices and
    // this one measured one. That is why applicability is separate from passing.
    const results = evaluateGates(passing, true);
    expect(results.filter((r) => r.applicable).every((r) => r.passed)).toBe(true);
    expect(results.filter((r) => !r.applicable).map((r) => r.gate.id)).toEqual([2]);
    expect(gatesFailed(results)).toBe(false);
  });

  test("a deliberately regressed compression policy fails the hot-window gate", () => {
    // compress_after back to 1 day leaves ~2 days uncompressed. Gate 5 is what
    // proves the tuning is live rather than merely committed.
    const results = evaluateGates({ ...passing, uncompressedWindowMb: 1011 }, true);
    expect(results.find((r) => r.gate.id === 5)?.passed).toBe(false);
    expect(gatesFailed(results)).toBe(true);
  });

  test("the single-device gate does not accept a five-device measurement, or the reverse", () => {
    // Each gate names its own conditions; a figure from the wrong shape of run
    // is not evidence for it.
    const five = evaluateGates({ ...passing, devices: 5, gbPerDay: 1.8 }, true);
    expect(five.find((r) => r.gate.id === 1)?.applicable).toBe(false);
    expect(five.find((r) => r.gate.id === 2)?.passed).toBe(true);
    expect(evaluateGates(passing, true).find((r) => r.gate.id === 2)?.applicable).toBe(false);
  });

  test("a slower poll cadence cannot satisfy a gate stated at 1 s", () => {
    // The measured baseline was taken at 3 s; quoting it against a 1 s gate is
    // exactly the confusion this rejects.
    const slow = evaluateGates({ ...passing, pollIntervalMs: 3000 }, true);
    const gate1 = slow.find((r) => r.gate.id === 1);
    expect(gate1?.applicable).toBe(false);
    expect(gate1?.passed).toBe(false);
    // …and the report says so, rather than a skipped headline gate reading as a
    // clean run.
    expect(formatGates(slow)[0]).toContain("not applicable");
  });

  test("the hardware gates are provisional off the target board, and do not fail a run", () => {
    // Gates 1-3 decide the card; a pass inside an LXC on another machine is not
    // evidence either way, so it must not be reported as one.
    const results = evaluateGates({ ...passing, gbPerDay: 99 }, false);
    const hardware = results.filter((r) => r.gate.needsTargetHardware);
    expect(hardware.every((r) => r.provisional)).toBe(true);
    expect(gatesFailed(results)).toBe(false);
    expect(formatGates(results).join("\n")).toContain("provisional");
  });

  test("an amplification that could not be computed does not pass by accident", () => {
    // NaN <= 4 is false in JS, but relying on that silently is how a missing
    // measurement becomes a pass.
    const results = evaluateGates({ ...passing, amplification: Number.NaN }, true);
    expect(results.find((r) => r.gate.id === 3)?.passed).toBe(false);
  });

  test("every gate is reported, in order, with its threshold", () => {
    const lines = formatGates(evaluateGates(passing, true));
    expect(lines).toHaveLength(GATES.length);
    expect(lines[0]).toContain("gate 1");
    expect(lines[0]).toContain("0.4 GB/day");
  });
});

// --- comparisons ------------------------------------------------------------

const sample = (gbPerDay: number, load1 = 1): WearSample => ({
  gbPerDay,
  idleGbPerDay: 0.04,
  rowsPerDay: 400_000,
  amplification: 3.5,
  load1,
  windowMs: HOUR,
});

const many = (n: number, gbPerDay: number, load1 = 1) =>
  Array.from({ length: n }, () => sample(gbPerDay, load1));

describe("comparing populations", () => {
  test("refuses a verdict from two samples", () => {
    // Never claim a regression from two samples: the refusal is the feature.
    const result = compareSamples(many(2, 1), many(2, 2));
    expect(result.verdict).toBe("incomparable");
    expect(result).toMatchObject({ why: expect.stringContaining(`>= ${MIN_SAMPLES}`) });
  });

  test("refuses a verdict across host load it is not comparable across", () => {
    const result = compareSamples(many(MIN_SAMPLES, 1, 0.5), many(MIN_SAMPLES, 2, 8));
    expect(result.verdict).toBe("incomparable");
    expect(result).toMatchObject({ why: expect.stringContaining("load differs") });
  });

  test("compares happily inside the load tolerance", () => {
    const result = compareSamples(
      many(MIN_SAMPLES, 1, 1),
      many(MIN_SAMPLES, 1, LOAD_TOLERANCE * 0.99),
    );
    expect(result.verdict).toBe("unchanged");
  });

  test("names a regression, an improvement and no change", () => {
    expect(compareSamples(many(MIN_SAMPLES, 1), many(MIN_SAMPLES, 2)).verdict).toBe("regressed");
    expect(compareSamples(many(MIN_SAMPLES, 2), many(MIN_SAMPLES, 1)).verdict).toBe("improved");
    expect(compareSamples(many(MIN_SAMPLES, 1), many(MIN_SAMPLES, 1.05)).verdict).toBe("unchanged");
  });

  test("a change just inside the tolerance is not a regression", () => {
    // The boundary matters: a 10 % band that fires at 10 % turns noise into news.
    expect(compareSamples(many(MIN_SAMPLES, 1), many(MIN_SAMPLES, 1.1)).verdict).toBe("unchanged");
    expect(compareSamples(many(MIN_SAMPLES, 1), many(MIN_SAMPLES, 1.11)).verdict).toBe("regressed");
  });

  test("zero load on both sides is comparable rather than a division by zero", () => {
    expect(compareSamples(many(MIN_SAMPLES, 1, 0), many(MIN_SAMPLES, 1, 0)).verdict).toBe(
      "unchanged",
    );
  });
});

describe("collecting a window", () => {
  /** A fake world: two io.stat readings, a clock that jumps when we sleep. */
  function fakeIo(readings: string[]) {
    let now = 0;
    let reads = 0;
    const logged: string[] = [];
    return {
      logged,
      io: {
        read: (path: string) =>
          path === "/proc/loadavg" ? "0.80 0.60 0.50 1/900 1234\n" : (readings[reads++] ?? ""),
        scalar: async (sql: string) => (sql.includes("count(*)") ? 1000 : 500_000_000),
        nowMs: () => now,
        sleep: async (ms: number) => {
          now += ms;
        },
        log: (line: string) => logged.push(line),
      },
    };
  }

  const gates = {
    devices: 1,
    pollIntervalMs: 1000,
    compressedBytesPerRow: 4.1,
    uncompressedWindowMb: 4,
    thinningReduction: 0.87,
    yearChartBuffers: 60,
  };

  test("reads both ends, derives the sample, and reports every gate", async () => {
    const { io, logged } = fakeIo([ioStat(0), ioStat(GB / 4)]);
    const { sample, results } = await runWindow(io, {
      cgroupIoStat: "/sys/fs/cgroup/x/io.stat",
      device: "253:16",
      idleGbPerDay: 0.04,
      windowMs: 24 * HOUR,
      gates,
      onTargetHardware: true,
    });
    expect(sample.gbPerDay).toBeCloseTo(0.21, 2);
    expect(sample.load1).toBe(0.8);
    // Both scalars are constant in the fake, so nothing was written by Postgres
    // over the window and the ratio is deliberately absent rather than infinite.
    expect(Number.isNaN(sample.amplification)).toBe(true);
    expect(results).toHaveLength(GATES.length);
    // The report leads with the measurement and names the subtracted baseline.
    expect(logged[0]).toContain("idle 0.040 subtracted");
    expect(logged.join("\n")).toContain("gate 7");
  });

  test("the window length comes from the clock, not from the requested duration", async () => {
    // A sleep that returns early (a suspended host) must not be reported as a
    // full window — the rate would be overstated by the difference.
    const { io } = fakeIo([ioStat(0), ioStat(GB)]);
    const shortSleep = { ...io, sleep: async () => {} };
    await expect(
      runWindow(shortSleep, {
        cgroupIoStat: "/x",
        device: "253:16",
        idleGbPerDay: 0,
        windowMs: HOUR,
        gates,
        onTargetHardware: true,
      }),
    ).rejects.toThrow(WearMeasurementError);
  });
});
