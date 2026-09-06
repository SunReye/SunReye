import { describe, expect, test } from "bun:test";
import type { PlantAggregate } from "@SunReye/inverter-core";
import { foldLiveSamples, foldRecentBackfills } from "./plant-fold";

const KINDS: Record<string, PlantAggregate> = {
  "pv.power": "sum",
  "battery.soc": "weighted-mean",
  "grid.voltage": "per-device",
};
const kindOf = (metric: string): PlantAggregate => KINDS[metric] ?? "per-device";

describe("foldRecentBackfills — the raw arm, aligned per device before summing", () => {
  test("two devices with the same grid sum bucket by bucket", () => {
    const out = foldRecentBackfills(
      [
        {
          weight: 1,
          backfill: { t0: 1000, step: 1, metrics: { "pv.power": { o: [0, 1, 2], v: [1, 2, 3] } } },
        },
        {
          weight: 1,
          backfill: {
            t0: 1000,
            step: 1,
            metrics: { "pv.power": { o: [0, 1, 2], v: [10, 20, 30] } },
          },
        },
      ],
      kindOf,
    );
    expect(out).toEqual({
      t0: 1000,
      step: 1,
      metrics: { "pv.power": { o: [0, 1, 2], v: [11, 22, 33] } },
    });
  });

  test("a device polled at a different instant is carried forward, not left as a dip", () => {
    // Device B has no sample in bucket 1: its bucket-0 value is held (LOCF), so
    // the plant does not read 2 W where it was really 22 W.
    const out = foldRecentBackfills(
      [
        {
          weight: 1,
          backfill: { t0: 1000, step: 1, metrics: { "pv.power": { o: [0, 1, 2], v: [1, 2, 3] } } },
        },
        {
          weight: 1,
          backfill: { t0: 1000, step: 1, metrics: { "pv.power": { o: [0, 2], v: [20, 30] } } },
        },
      ],
      kindOf,
    );
    expect(out.metrics["pv.power"]).toEqual({ o: [0, 1, 2], v: [21, 22, 33] });
  });

  test("before a device's first sample it contributes nothing — never zero", () => {
    const out = foldRecentBackfills(
      [
        {
          weight: 1,
          backfill: { t0: 1000, step: 1, metrics: { "pv.power": { o: [0, 1], v: [1, 2] } } },
        },
        {
          weight: 1,
          backfill: { t0: 1000, step: 1, metrics: { "pv.power": { o: [1], v: [20] } } },
        },
      ],
      kindOf,
    );
    expect(out.metrics["pv.power"]).toEqual({ o: [0, 1], v: [1, 22] });
  });

  test("the grids are aligned on the earliest t0", () => {
    const out = foldRecentBackfills(
      [
        { weight: 1, backfill: { t0: 2000, step: 1, metrics: { "pv.power": { o: [0], v: [1] } } } },
        {
          weight: 1,
          backfill: { t0: 1000, step: 1, metrics: { "pv.power": { o: [0], v: [10] } } },
        },
      ],
      kindOf,
    );
    expect(out.t0).toBe(1000);
    expect(out.metrics["pv.power"]).toEqual({ o: [0, 1], v: [10, 11] });
  });

  test("a weighted mean weights by member capacity: 10 kWh @100 % + 5 kWh @40 % = 80 %", () => {
    const out = foldRecentBackfills(
      [
        {
          weight: 10,
          backfill: { t0: 0, step: 1, metrics: { "battery.soc": { o: [0], v: [100] } } },
        },
        {
          weight: 5,
          backfill: { t0: 0, step: 1, metrics: { "battery.soc": { o: [0], v: [40] } } },
        },
      ],
      kindOf,
    );
    expect(out.metrics["battery.soc"]).toEqual({ o: [0], v: [80] });
  });

  test("a per-device metric is DROPPED from the plant payload", () => {
    const out = foldRecentBackfills(
      [
        {
          weight: 1,
          backfill: { t0: 0, step: 1, metrics: { "grid.voltage": { o: [0], v: [230] } } },
        },
      ],
      kindOf,
    );
    expect(out.metrics).toEqual({});
  });

  test("a metric only one device reports is that device's series", () => {
    const out = foldRecentBackfills(
      [
        { weight: 1, backfill: { t0: 0, step: 1, metrics: { "pv.power": { o: [0], v: [5] } } } },
        { weight: 1, backfill: { t0: 0, step: 1, metrics: {} } },
      ],
      kindOf,
    );
    expect(out.metrics["pv.power"]).toEqual({ o: [0], v: [5] });
  });

  test("no members is an empty backfill with a finite t0", () => {
    expect(foldRecentBackfills([], kindOf)).toEqual({ t0: 0, step: 1, metrics: {} });
  });

  test("an empty backfill from every member keeps the step and a finite t0", () => {
    const out = foldRecentBackfills(
      [{ weight: 1, backfill: { t0: 0, step: 5, metrics: {} } }],
      kindOf,
    );
    expect(out).toEqual({ t0: 0, step: 5, metrics: {} });
  });
});

describe("foldLiveSamples — the plant's live reading", () => {
  const at = (ms: number) => new Date(ms).toISOString();
  const member = (slug: string, timeMs: number, metrics: Record<string, number>, weight = 1) => ({
    slug,
    weight,
    sample: { time: at(timeMs), metrics },
  });

  test("fresh members are folded by the role's aggregate", () => {
    const out = foldLiveSamples(
      [
        member("a", 10_000, { "pv.power": 100, "battery.soc": 100, "grid.voltage": 230 }, 10),
        member("b", 10_500, { "pv.power": 50, "battery.soc": 40, "grid.voltage": 231 }, 5),
      ],
      { nowMs: 11_000, staleAfterMs: 5_000, aggregateOf: kindOf },
    );
    expect(out.metrics).toEqual({ "pv.power": 150, "battery.soc": 80 });
    expect(out.members).toEqual(["a", "b"]);
    expect(out.stale).toEqual([]);
    expect(out.time).toBe(at(10_500));
  });

  test("a stale member is EXCLUDED and named, never counted as zero", () => {
    const out = foldLiveSamples(
      [member("a", 10_000, { "pv.power": 100 }), member("b", 1_000, { "pv.power": 50 })],
      { nowMs: 11_000, staleAfterMs: 5_000, aggregateOf: kindOf },
    );
    expect(out.metrics).toEqual({ "pv.power": 100 });
    expect(out.stale).toEqual(["b"]);
    expect(out.members).toEqual(["a", "b"]);
  });

  test("a fresh reading of 0 W IS counted as 0", () => {
    const out = foldLiveSamples(
      [member("a", 10_000, { "pv.power": 100 }), member("b", 10_000, { "pv.power": 0 })],
      { nowMs: 11_000, staleAfterMs: 5_000, aggregateOf: kindOf },
    );
    expect(out.metrics["pv.power"]).toBe(100);
  });

  test("a member with no sample yet is stale", () => {
    const out = foldLiveSamples(
      [member("a", 10_000, { "pv.power": 100 }), { slug: "b", weight: 1, sample: null }],
      { nowMs: 11_000, staleAfterMs: 5_000, aggregateOf: kindOf },
    );
    expect(out.stale).toEqual(["b"]);
    expect(out.metrics["pv.power"]).toBe(100);
  });

  test("a non-finite value is skipped for that member", () => {
    const out = foldLiveSamples(
      [member("a", 10_000, { "pv.power": Number.NaN }), member("b", 10_000, { "pv.power": 7 })],
      { nowMs: 11_000, staleAfterMs: 5_000, aggregateOf: kindOf },
    );
    expect(out.metrics["pv.power"]).toBe(7);
  });

  test("every member stale is an empty reading stamped at `now`", () => {
    const out = foldLiveSamples([member("a", 0, { "pv.power": 1 })], {
      nowMs: 11_000,
      staleAfterMs: 5_000,
      aggregateOf: kindOf,
    });
    expect(out.metrics).toEqual({});
    expect(out.time).toBe(at(11_000));
  });
});
