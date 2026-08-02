import type { CanonicalRole, InverterProfile, InverterSample } from "@SunReye/inverter-core";
import { describe, expect, mock, test } from "bun:test";

// cost.ts imports the DB singleton (which eagerly validates server env). Mock it
// so the DB-free guard logic can be imported and exercised without a database or
// a populated .env — mirroring inverter.test.ts's approach. The live sample is an
// injectable argument, so the poll cache needs no stand-in.
// `fetchBucketEnergy` runs two queries — the pre-window baseline, then the
// in-window buckets — so the stub answers from a queue in that order.
let queryResults: Array<Array<Record<string, unknown>>> = [];
const execute = mock(async () => ({ rows: queryResults.shift() ?? [] }));
mock.module("@SunReye/db", () => ({ db: { execute } }));

const { fetchBucketEnergy, liveTodayTotals } = await import("./cost");

/** The live overlay for `inverterId` at `now`, given the poll cache's `sample`. */
const overlayFor = (
  profile: InverterProfile,
  sample: InverterSample | null,
  inverterId: string,
  now: Date,
) => liveTodayTotals(profile, inverterId, now, sample);

/** Minimal profile mapping the given canonical roles → metric keys. */
const profileWith = (roleKeys: Partial<Record<CanonicalRole, string>>): InverterProfile =>
  ({
    id: "inv-1",
    metrics: Object.entries(roleKeys).map(([role, key]) => ({ role, key })),
  }) as unknown as InverterProfile;

/** All four today-twin roles mapped to distinct metric keys. */
const fullProfile = profileWith({
  "grid.energy.imported.today": "imp",
  "grid.energy.exported.today": "exp",
  "load.energy.today": "load",
  "production.today": "prod",
});

/** A live sample on the given local day, for `inv-1` unless overridden. */
const sample = (
  localDay: Date,
  metrics: Record<string, number>,
  inverterId = "inv-1",
): InverterSample => ({
  time: localDay.toISOString(),
  inverterId,
  metrics,
});

// A fixed "now" and a same-local-day sample time, both built from local fields
// so the same-day comparison holds regardless of the runner's timezone.
const now = new Date(2024, 5, 15, 13, 0, 0);
const today = new Date(2024, 5, 15, 12, 30, 0);
const yesterday = new Date(2024, 5, 14, 23, 59, 0);

const liveMetrics = { imp: 1.1, exp: 2.2, load: 8.6, prod: 5.5 };

describe("liveTodayTotals", () => {
  test("null live sample → empty (no override)", () => {
    expect(overlayFor(fullProfile, null, "inv-1", now)).toEqual({});
  });

  test("inverterId mismatch → empty (no override)", () => {
    const s = sample(today, liveMetrics, "other-inverter");
    expect(overlayFor(fullProfile, s, "inv-1", now)).toEqual({});
  });

  test("stale sample from a previous local day → empty (no override across midnight)", () => {
    const s = sample(yesterday, liveMetrics);
    expect(overlayFor(fullProfile, s, "inv-1", now)).toEqual({});
  });

  test("all guards pass → every mapped, finite field is returned", () => {
    const s = sample(today, liveMetrics);
    expect(overlayFor(fullProfile, s, "inv-1", now)).toEqual({
      importKwh: 1.1,
      exportKwh: 2.2,
      loadKwh: 8.6,
      productionKwh: 5.5,
    });
  });

  test("unmapped today-twin role → that field is left out (kept on the delta value)", () => {
    // Only load + production twins mapped; import/export absent from the profile.
    const partial = profileWith({
      "load.energy.today": "load",
      "production.today": "prod",
    });
    const s = sample(today, liveMetrics);
    expect(overlayFor(partial, s, "inv-1", now)).toEqual({
      loadKwh: 8.6,
      productionKwh: 5.5,
    });
  });

  test("mapped role missing / non-finite in the sample → that field is skipped", () => {
    // `imp` absent, `exp` NaN, `prod` Infinity → only the finite `load` survives.
    const s = sample(today, { load: 8.6, exp: Number.NaN, prod: Number.POSITIVE_INFINITY });
    expect(overlayFor(fullProfile, s, "inv-1", now)).toEqual({ loadKwh: 8.6 });
  });

  test("an explicit zero is a valid override (finite, not skipped)", () => {
    const s = sample(today, { imp: 0, exp: 0, load: 0, prod: 0 });
    expect(overlayFor(fullProfile, s, "inv-1", now)).toEqual({
      importKwh: 0,
      exportKwh: 0,
      loadKwh: 0,
      productionKwh: 0,
    });
  });
});

describe("fetchBucketEnergy", () => {
  // One counter only: the import total, so the deltas below are unambiguous.
  const importProfile = profileWith({ "grid.energy.imported.total": "imp" });
  const hour = (h: number) => new Date(Date.UTC(2024, 5, 15, h));
  /** A rollup row as the views return it. */
  const bucketRow = (at: Date, min: number, max: number) => ({
    bucket: at.toISOString(),
    metric: "imp",
    min_value: min,
    max_value: max,
  });

  /** Import kWh per bucket, given the baseline row(s) and the in-window rows. */
  const importsFor = async (
    baseline: Array<Record<string, unknown>>,
    rows: Array<Record<string, unknown>>,
  ) => {
    queryResults = [baseline, rows];
    const buckets = await fetchBucketEnergy(
      importProfile,
      "inv-1",
      hour(0),
      hour(23),
      "hourly_rollups",
    );
    return buckets.map((b) => b.import);
  };

  test("an adjacent baseline prices the first bucket as a rise from prior state", async () => {
    const imports = await importsFor(
      [{ metric: "imp", bucket: hour(-1).toISOString(), last_max: 100 }],
      [bucketRow(hour(0), 100.5, 101)],
    );
    expect(imports).toEqual([1]);
  });

  test("a baseline on the far side of a recording gap is not bridged", async () => {
    // Recorder was down for three days; the counter rose 5 kWh in that hole.
    // Billing it to the first hour back would put three days of energy in this
    // window — the bucket may only claim the 0.5 it watched happen.
    const imports = await importsFor(
      [{ metric: "imp", bucket: new Date(Date.UTC(2024, 5, 12, 8)).toISOString(), last_max: 100 }],
      [bucketRow(hour(0), 105, 105.5)],
    );
    expect(imports).toEqual([0.5]);
  });

  test("a gap inside the window breaks the chain at the bucket after it", async () => {
    const imports = await importsFor(
      [{ metric: "imp", bucket: hour(-1).toISOString(), last_max: 100 }],
      [
        bucketRow(hour(0), 100, 101),
        // Nothing recorded for hours 1–9; hour 10 comes back 8 kWh higher.
        bucketRow(hour(10), 109, 109.5),
        bucketRow(hour(11), 109.5, 110),
      ],
    );
    expect(imports).toEqual([1, 0.5, 0.5]);
  });

  test("a short hole is still bridged — a restart must not drop the energy", async () => {
    const imports = await importsFor(
      [{ metric: "imp", bucket: hour(-1).toISOString(), last_max: 100 }],
      [bucketRow(hour(0), 100, 101), bucketRow(hour(2), 101.4, 101.5)],
    );
    expect(imports).toEqual([1, 0.5]);
  });
});
