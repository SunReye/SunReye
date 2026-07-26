import type { CanonicalRole, InverterProfile, InverterSample } from "@SunReye/inverter-core";
import { describe, expect, mock, test } from "bun:test";

// cost.ts imports the DB singleton (which eagerly validates server env). Mock it
// so the DB-free guard logic can be imported and exercised without a database or
// a populated .env — mirroring inverter.test.ts's approach. The live sample is an
// injectable argument, so the poll cache needs no stand-in.
mock.module("@SunReye/db", () => ({ db: {} }));

const { liveTodayTotals } = await import("./cost");

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
