import { describe, expect, test } from "bun:test";
import {
  assertIdentifier,
  type TierWindow,
  bucketToInterval,
  bucketWidthMs,
  pendingChunks,
  planReplay,
} from "./replay";

const at = (iso: string) => new Date(iso);

describe("bucketWidthMs", () => {
  test("is the tier's own width — the dur_ms every replayed row of it carries", () => {
    expect(bucketWidthMs("minute")).toBe(60_000);
    expect(bucketWidthMs("hourly")).toBe(3_600_000);
    expect(bucketWidthMs("daily")).toBe(86_400_000);
  });
});

describe("bucketToInterval", () => {
  test("stamps the row at the bucket START and carries the width as dur_ms", () => {
    const row = bucketToInterval("hourly", { bucket: at("2026-07-28T13:00:00Z"), avgValue: 42.5 });
    expect(row).toEqual({ time: at("2026-07-28T13:00:00Z"), value: 42.5, durMs: 3_600_000 });
  });

  test("preserves the mean exactly — it is the only value replay keeps", () => {
    const avg = 1234.5678901234;
    expect(
      bucketToInterval("minute", { bucket: at("2026-07-28T13:00:00Z"), avgValue: avg })?.value,
    ).toBe(avg);
  });

  test("keeps a ZERO mean: measured zero is a reading, not an absence", () => {
    const row = bucketToInterval("minute", { bucket: at("2026-07-28T00:00:00Z"), avgValue: 0 });
    expect(row?.value).toBe(0);
  });

  test("keeps a NEGATIVE mean: export and battery discharge are signed", () => {
    const row = bucketToInterval("daily", { bucket: at("2026-07-28T00:00:00Z"), avgValue: -2500 });
    expect(row).toEqual({ time: at("2026-07-28T00:00:00Z"), value: -2500, durMs: 86_400_000 });
  });

  test("drops a bucket with no mean — a null avg is not a reading", () => {
    expect(
      bucketToInterval("minute", { bucket: at("2026-07-28T00:00:00Z"), avgValue: null }),
    ).toBeNull();
  });

  test("accepts a bucket timestamp that arrived as text", () => {
    const row = bucketToInterval("minute", { bucket: "2026-07-28T13:07:00.000Z", avgValue: 1 });
    expect(row?.time.toISOString()).toBe("2026-07-28T13:07:00.000Z");
  });

  test("refuses a bucket timestamp it cannot parse rather than stamping Invalid Date", () => {
    expect(() => bucketToInterval("minute", { bucket: "not a time", avgValue: 1 })).toThrow(
      /bucket timestamp/,
    );
  });
});

const windows = (spec: Array<[TierWindow["tier"], string, string]>): TierWindow[] =>
  spec.map(([tier, from, to]) => ({ tier, from: at(from), to: at(to) }));

/**
 * Tier CHOICE, exercised through the planner rather than through the internal
 * predicate: which tier answers a day is only meaningful as part of a plan, and
 * a one-day span makes the answer unambiguous.
 */
describe("choosing a tier", () => {
  const all = windows([
    ["minute", "2026-06-01T00:00:00Z", "2026-08-01T00:00:00Z"],
    ["hourly", "2026-01-01T00:00:00Z", "2026-08-01T00:00:00Z"],
    ["daily", "2020-01-01T00:00:00Z", "2026-08-01T00:00:00Z"],
  ]);

  const tierFor = (from: string, to: string, w = all) =>
    planReplay({ from: at(from), to: at(to), windows: w }).chunks[0]?.tier ?? null;

  test("prefers the finest tier that covers the whole day", () => {
    expect(tierFor("2026-07-01T00:00:00Z", "2026-07-02T00:00:00Z")).toBe("minute");
  });

  test("falls back one tier when the finest covers only part of the day", () => {
    expect(tierFor("2026-05-31T00:00:00Z", "2026-06-01T00:00:00Z")).toBe("hourly");
  });

  test("falls back to daily when neither finer tier reaches", () => {
    expect(tierFor("2021-01-01T00:00:00Z", "2021-01-02T00:00:00Z")).toBe("daily");
  });

  test("plans nothing when no tier covers the day at all", () => {
    expect(tierFor("2019-01-01T00:00:00Z", "2019-01-02T00:00:00Z")).toBeNull();
  });

  test("an empty window list covers nothing", () => {
    expect(tierFor("2026-07-01T00:00:00Z", "2026-07-02T00:00:00Z", [])).toBeNull();
  });

  test("a window whose end IS the span's end still covers it — the end is exclusive", () => {
    const only = windows([["minute", "2026-07-01T00:00:00Z", "2026-07-02T00:00:00Z"]]);
    expect(tierFor("2026-07-01T00:00:00Z", "2026-07-02T00:00:00Z", only)).toBe("minute");
  });
});

describe("planReplay", () => {
  const twoMonths = windows([
    ["minute", "2026-06-01T00:00:00Z", "2026-08-01T00:00:00Z"],
    ["hourly", "2026-01-01T00:00:00Z", "2026-08-01T00:00:00Z"],
  ]);

  test("chunks by UTC day, in ascending order, half-open", () => {
    const plan = planReplay({
      from: at("2026-07-01T00:00:00Z"),
      to: at("2026-07-04T00:00:00Z"),
      windows: twoMonths,
    });
    expect(plan.gaps).toEqual([]);
    expect(plan.chunks.map((c) => [c.tier, c.start.toISOString(), c.end.toISOString()])).toEqual([
      ["minute", "2026-07-01T00:00:00.000Z", "2026-07-02T00:00:00.000Z"],
      ["minute", "2026-07-02T00:00:00.000Z", "2026-07-03T00:00:00.000Z"],
      ["minute", "2026-07-03T00:00:00.000Z", "2026-07-04T00:00:00.000Z"],
    ]);
  });

  test("keeps a PARTIAL first and last day rather than rounding the span outwards", () => {
    const plan = planReplay({
      from: at("2026-07-01T10:30:00Z"),
      to: at("2026-07-02T04:15:00Z"),
      windows: twoMonths,
    });
    expect(plan.chunks.map((c) => [c.start.toISOString(), c.end.toISOString()])).toEqual([
      ["2026-07-01T10:30:00.000Z", "2026-07-02T00:00:00.000Z"],
      ["2026-07-02T00:00:00.000Z", "2026-07-02T04:15:00.000Z"],
    ]);
  });

  test("a span inside one day is one chunk", () => {
    const plan = planReplay({
      from: at("2026-07-01T10:00:00Z"),
      to: at("2026-07-01T11:00:00Z"),
      windows: twoMonths,
    });
    expect(plan.chunks).toHaveLength(1);
  });

  test("an empty or inverted span plans nothing", () => {
    for (const [from, to] of [
      ["2026-07-01T00:00:00Z", "2026-07-01T00:00:00Z"],
      ["2026-07-02T00:00:00Z", "2026-07-01T00:00:00Z"],
    ] as const) {
      expect(planReplay({ from: at(from), to: at(to), windows: twoMonths }).chunks).toEqual([]);
    }
  });

  test("uses the finest tier per day, so a minute window that starts mid-span switches tiers", () => {
    const plan = planReplay({
      from: at("2026-05-30T00:00:00Z"),
      to: at("2026-06-03T00:00:00Z"),
      windows: twoMonths,
    });
    expect(plan.chunks.map((c) => `${c.tier} ${c.start.toISOString().slice(0, 10)}`)).toEqual([
      "hourly 2026-05-30",
      "hourly 2026-05-31",
      "minute 2026-06-01",
      "minute 2026-06-02",
    ]);
  });

  test("reports a day no tier covers as a GAP instead of skipping it silently", () => {
    const plan = planReplay({
      from: at("2025-12-30T00:00:00Z"),
      to: at("2026-01-02T00:00:00Z"),
      windows: twoMonths,
    });
    expect(plan.chunks.map((c) => c.start.toISOString().slice(0, 10))).toEqual(["2026-01-01"]);
    expect(plan.gaps.map((g) => g.start.toISOString().slice(0, 10))).toEqual([
      "2025-12-30",
      "2025-12-31",
    ]);
  });
});

describe("pendingChunks", () => {
  const plan = planReplay({
    from: at("2026-07-01T00:00:00Z"),
    to: at("2026-07-04T00:00:00Z"),
    windows: windows([["minute", "2026-06-01T00:00:00Z", "2026-08-01T00:00:00Z"]]),
  });

  /**
   * The watermark's identity is the chunk's START as an ISO instant — spelled out
   * here because the recorded rows and the pending set have to key on the same
   * string, and a change of format would look like "nothing was ever completed".
   */
  const keys = (chunks: readonly { start: Date }[]) =>
    chunks.map((chunk) => chunk.start.toISOString());

  test("drops the chunks already recorded and keeps the rest, in order", () => {
    const done = new Set(["2026-07-01T00:00:00.000Z", "2026-07-02T00:00:00.000Z"]);
    expect(keys(pendingChunks(plan.chunks, done))).toEqual(["2026-07-03T00:00:00.000Z"]);
  });

  test("nothing recorded means everything is pending", () => {
    expect(pendingChunks(plan.chunks, new Set())).toHaveLength(3);
  });

  test("everything recorded means a re-run does nothing at all — the idempotence rule", () => {
    expect(pendingChunks(plan.chunks, new Set(keys(plan.chunks)))).toEqual([]);
  });
});

describe("assertIdentifier", () => {
  test("accepts the relation and column names a legacy source actually has", () => {
    for (const name of ["legacy_minute_rollups", "bucket", "avg_value", "inverter_id", "t1"]) {
      expect(assertIdentifier(name)).toBe(name);
    }
  });

  test("refuses anything that is not a bare lower-case identifier", () => {
    // These names are interpolated into SQL: a relation cannot be a bound
    // parameter, so the only defence is refusing to interpolate a name that is
    // not one.
    for (const name of [
      "",
      "legacy minute",
      "public.minute_rollups",
      'x"; drop table metrics_raw; --',
      "Bucket",
      "1st_tier",
      "a".repeat(64),
    ]) {
      expect(() => assertIdentifier(name)).toThrow(/identifier/);
    }
  });
});
