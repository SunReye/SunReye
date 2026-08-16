import type { CanonicalRole, InverterProfile, InverterSample } from "@SunReye/inverter-core";
import { afterAll, describe, expect, mock, test } from "bun:test";

// energy.ts → cost.ts imports the DB singleton (which eagerly validates server
// env) and reads the live poll cache + plant-zone setting. Mock those so the
// pure orchestration can run without a database or populated .env.
//
// The spreads are load-bearing: `mock.module` is process-global and permanent,
// so a mock returning only the exports THIS suite needs would delete the rest
// for every file that runs afterwards. Override what is stubbed, keep the rest
// real, and hand the real exports back BY VALUE in afterAll.
const realDb = await import("@SunReye/db");
const realState = await import("../shared/state");
const realDbExports = { ...realDb };
const realStateExports = { ...realState };

afterAll(() => {
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
  mock.module("../shared/state", () => ({ ...realStateExports }));
});

let queryResults: Array<Array<Record<string, unknown>>> = [];
const execute = mock(async () => ({ rows: queryResults.shift() ?? [] }));

// app_settings reads (plant zone) resolve to the stored default (no row), so the
// plant zone falls back to the host process zone — the same zone the window
// Dates below are built in, keeping the period keys deterministic per run.
const select = () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: async () => [],
    limit: async () => [],
  };
  return chain;
};
mock.module("@SunReye/db", () => ({ ...realDb, db: { execute, select } }));

const liveState: { latest: InverterSample | null } = { latest: null };
mock.module("../shared/state", () => ({ ...realState, liveState }));

const { energySeries } = await import("./energy");
const { currentPeriodKey } = await import("./cost");

/** Minimal profile mapping the given canonical roles → metric keys. */
const profileWith = (roleKeys: Partial<Record<CanonicalRole, string>>): InverterProfile =>
  ({
    id: "inv-1",
    metrics: Object.entries(roleKeys).map(([role, key]) => ({ role, key })),
  }) as unknown as InverterProfile;

const profile = profileWith({ "grid.energy.imported.total": "imp" });

/** First and last day of the calendar month `now` falls in, as local Dates. */
const monthWindow = (now: Date) => ({
  from: new Date(now.getFullYear(), now.getMonth(), 1),
  to: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  days: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
});

describe("energySeries — which day periods get a bar", () => {
  test("a month window zero-fills every day of the month, including days still to come", async () => {
    // The energy chart must share the cost series' x-axis extent: both run to
    // the month's end so the two stacked charts align, even though today is
    // mid-month. (Before, energySeries capped the day bucket to today.)
    const now = new Date();
    const { from, to, days } = monthWindow(now);
    queryResults = [[]];
    const points = await energySeries(profile, { from, to, bucket: "day", inverterId: "inv-1" });

    expect(points.length).toBe(days);
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    expect(points.at(-1)?.bucket).toBe(`${y}-${m}-${String(days).padStart(2, "0")}`);
    // Today is present and is NOT the last bar unless today IS month-end.
    expect(points.map((p) => p.bucket)).toContain(currentPeriodKey("day", now));
  });

  test("the live today-override lands only on today's bar, never a future one (#52)", async () => {
    // A month window ending in the future, with a live *.today sample: the
    // override must fill today's bar and leave every future day at zero — no
    // full previous day leaking onto tomorrow.
    const now = new Date();
    // A window from the 1st to three days past today, so future day bars always
    // exist regardless of when the suite runs (avoids month-end flakiness).
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
    const todaySample = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
    const overrideProfile = profileWith({
      "grid.energy.imported.today": "imp",
      "load.energy.today": "load",
      "production.today": "prod",
    });
    liveState.latest = {
      time: todaySample.toISOString(),
      inverterId: "inv-1",
      metrics: { imp: 1.1, load: 8.6, prod: 5.5 },
    };
    try {
      queryResults = [[]];
      const points = await energySeries(overrideProfile, {
        from,
        to,
        bucket: "day",
        inverterId: "inv-1",
      });
      const todayKey = currentPeriodKey("day", now);
      const todayBar = points.find((p) => p.bucket === todayKey);
      expect(todayBar?.loadKwh).toBeCloseTo(8.6, 6);
      expect(todayBar?.productionKwh).toBeCloseTo(5.5, 6);

      // Every day strictly after today carries no energy (no future leak).
      const future = points.filter((p) => p.bucket > todayKey);
      expect(future.length).toBeGreaterThan(0); // window really does extend past today
      for (const f of future) {
        expect(f.loadKwh).toBe(0);
        expect(f.productionKwh).toBe(0);
      }
    } finally {
      liveState.latest = null;
    }
  });
});
