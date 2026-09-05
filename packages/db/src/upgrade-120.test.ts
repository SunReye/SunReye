import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type CatalogState,
  LEGACY_NAME,
  baselinePlan,
  cadenceMs,
  classifyBaselineStatement,
  classifyUpgrade,
  detachPolicyStatements,
  historyHorizon,
  horizonProblem,
  renameStatements,
  replayEnd,
} from "./upgrade-120";

/** A catalog with only what the test names, spelled as plain arrays. */
interface CatalogInput {
  relations?: readonly string[];
  indexes?: readonly string[];
  constraints?: readonly string[];
  columns?: readonly (readonly [string, ReadonlySet<string>])[];
}

function state(partial: CatalogInput = {}): CatalogState {
  return {
    relations: new Set(partial.relations ?? []),
    indexes: new Set(partial.indexes ?? []),
    constraints: new Set(partial.constraints ?? []),
    columns: new Map(partial.columns ?? []),
  };
}

/** The relations, indexes and columns a restored addon-1.2.0 database has. */
const LEGACY_120 = state({
  relations: [
    "user",
    "account",
    "session",
    "verification",
    "apikey",
    "app_settings",
    "installed_profiles",
    "custom_charts",
    "metrics_raw",
    "minute_rollups",
    "hourly_rollups",
    "daily_rollups",
  ],
  indexes: ["metrics_raw_time_idx", "metrics_raw_metric_time_idx", "account_userId_idx"],
  constraints: ["user_email_unique", "account_user_id_user_id_fk"],
  columns: [
    ["metrics_raw", new Set(["time", "inverter_id", "metric", "value"])],
    ["user", new Set(["id", "name", "email"])],
  ],
});

describe("classifyUpgrade", () => {
  test("a restored 1.2.0 database needs the renames", () => {
    expect(classifyUpgrade(LEGACY_120)).toBe("rename-pending");
  });

  test("an empty database needs nothing — the baseline runs normally", () => {
    expect(classifyUpgrade(state())).toBe("not-needed");
  });

  test("a 2.0.0 database needs nothing: metrics_raw is already re-keyed", () => {
    expect(
      classifyUpgrade(
        state({
          relations: ["metrics_raw", "devices", "metric_keys"],
          columns: [
            ["metrics_raw", new Set(["time", "value", "dur_ms", "device_id", "metric_id"])],
          ],
        }),
      ),
    ).toBe("not-needed");
  });

  test("a database killed after the rename resumes rather than renaming twice", () => {
    // THE dangerous case: re-running the rename here would rename the NEW
    // metrics_raw out from under 2.0.0 and hand the freed name to nothing.
    expect(
      classifyUpgrade(
        state({
          relations: ["metrics_raw_legacy", "legacy_minute_rollups"],
          columns: [["metrics_raw_legacy", new Set(["time", "inverter_id", "metric", "value"])]],
        }),
      ),
    ).toBe("rename-done");
  });

  test("a legacy table beside a legacy-shaped metrics_raw is ambiguous, not a guess", () => {
    expect(
      classifyUpgrade(
        state({
          relations: ["metrics_raw", "metrics_raw_legacy"],
          columns: [
            ["metrics_raw", new Set(["time", "inverter_id", "metric", "value"])],
            ["metrics_raw_legacy", new Set(["time", "inverter_id", "metric", "value"])],
          ],
        }),
      ),
    ).toBe("ambiguous");
  });

  test("the new metrics_raw beside the legacy one is a resumed upgrade, not ambiguous", () => {
    expect(
      classifyUpgrade(
        state({
          relations: ["metrics_raw", "metrics_raw_legacy"],
          columns: [
            ["metrics_raw", new Set(["time", "value", "dur_ms", "device_id", "metric_id"])],
            ["metrics_raw_legacy", new Set(["time", "inverter_id", "metric", "value"])],
          ],
        }),
      ),
    ).toBe("rename-done");
  });
});

describe("detachPolicyStatements", () => {
  const statements = detachPolicyStatements();

  test("the minute tier's retention is removed — the decisive statement", () => {
    // Without it the 90-day retention keeps dropping the oldest buckets while
    // the upgrade waits for the user to click, and on a ~60-day instance the
    // oldest are ~30 days from deletion.
    expect(statements).toContain(
      "select remove_retention_policy('minute_rollups', if_exists => true)",
    );
  });

  test("every 1.2.0 policy is named", () => {
    const joined = statements.join("\n");
    for (const fragment of [
      "remove_continuous_aggregate_policy('minute_rollups'",
      "remove_continuous_aggregate_policy('hourly_rollups'",
      "remove_continuous_aggregate_policy('daily_rollups'",
      "remove_retention_policy('minute_rollups'",
      "remove_retention_policy('hourly_rollups'",
      "remove_retention_policy('metrics_raw'",
      "remove_compression_policy('minute_rollups'",
      "remove_compression_policy('metrics_raw'",
    ]) {
      expect(joined).toContain(fragment);
    }
  });

  test("every statement tolerates an absent policy, so a re-run is a no-op", () => {
    for (const statement of statements) {
      expect(statement).toMatch(/if_(exists|not_exists) => true/);
    }
  });

  test("policies are detached under their CURRENT names, before any rename", () => {
    // A retention policy is keyed on the hypertable's OID, so it FOLLOWS a
    // rename. Naming the legacy names here would remove nothing at all.
    expect(statements.join("\n")).not.toContain("legacy_");
  });
});

describe("renameStatements", () => {
  test("a restored 1.2.0 database renames all four relations and both indexes", () => {
    const statements = renameStatements(LEGACY_120);
    expect(statements).toEqual([
      "alter materialized view minute_rollups set (timescaledb.materialized_only = true)",
      "alter materialized view hourly_rollups set (timescaledb.materialized_only = true)",
      "alter materialized view daily_rollups set (timescaledb.materialized_only = true)",
      "alter materialized view minute_rollups rename to legacy_minute_rollups",
      "alter materialized view hourly_rollups rename to legacy_hourly_rollups",
      "alter materialized view daily_rollups rename to legacy_daily_rollups",
      "alter table metrics_raw rename to metrics_raw_legacy",
      "alter index metrics_raw_time_idx rename to metrics_raw_legacy_time_idx",
      "alter index metrics_raw_metric_time_idx rename to metrics_raw_legacy_metric_time_idx",
    ]);
  });

  test("an already-renamed relation is skipped, so the step is idempotent", () => {
    const partial = state({
      relations: [...LEGACY_120.relations, "legacy_minute_rollups"].filter(
        (r) => r !== "minute_rollups",
      ),
      indexes: [...LEGACY_120.indexes],
    });
    const statements = renameStatements(partial);
    expect(statements.some((s) => s.includes("minute_rollups rename"))).toBe(false);
    expect(statements).toContain(
      "alter materialized view hourly_rollups rename to legacy_hourly_rollups",
    );
  });

  test("an index 1.2.0 never had is not renamed", () => {
    const partial = state({ relations: ["metrics_raw"], indexes: [] });
    expect(renameStatements(partial).some((s) => s.startsWith("alter index"))).toBe(false);
  });

  test("nothing at all yields nothing at all", () => {
    expect(renameStatements(state())).toEqual([]);
  });

  test("the real-time arm is switched off BEFORE the rename", () => {
    // With materialized_only = false the legacy view unions a live scan of
    // metrics_raw_legacy into every read — including the min/max the replay
    // plans from — and nothing writes to that table again.
    const statements = renameStatements(LEGACY_120);
    const off = statements.findIndex((s) => s.includes("materialized_only = true"));
    const rename = statements.findIndex((s) => s.includes("rename to legacy_"));
    expect(off).toBeLessThan(rename);
  });
});

describe("classifyBaselineStatement", () => {
  test("a CREATE TABLE yields its name and its declared columns", () => {
    const parsed = classifyBaselineStatement(
      'CREATE TABLE "plants" (\n\t"id" smallint PRIMARY KEY,\n\t"name" text NOT NULL,\n\tCONSTRAINT "plants_slug_unique" UNIQUE("slug")\n);',
    );
    expect(parsed).toMatchObject({ kind: "table", name: "plants" });
    expect(parsed.kind === "table" && parsed.columns).toEqual(["id", "name"]);
  });

  test("an inline CONSTRAINT line is not mistaken for a column", () => {
    const parsed = classifyBaselineStatement(
      'CREATE TABLE "spot_prices" (\n\t"zone" text NOT NULL,\n\tCONSTRAINT "spot_prices_zone_slot_start_pk" PRIMARY KEY("zone","slot_start")\n);',
    );
    expect(parsed.kind === "table" && parsed.columns).toEqual(["zone"]);
  });

  test("an ALTER TABLE ADD CONSTRAINT yields the constraint and its table", () => {
    expect(
      classifyBaselineStatement(
        'ALTER TABLE "devices" ADD CONSTRAINT "devices_plant_id_plants_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id");',
      ),
    ).toMatchObject({
      kind: "constraint",
      name: "devices_plant_id_plants_id_fk",
      table: "devices",
    });
  });

  test("a CREATE INDEX yields the index name", () => {
    expect(
      classifyBaselineStatement(
        'CREATE INDEX "devices_plant_role_idx" ON "devices" USING btree ("plant_id","role");',
      ),
    ).toMatchObject({ kind: "index", name: "devices_plant_role_idx" });
  });

  test("a CREATE UNIQUE INDEX is an index too", () => {
    expect(
      classifyBaselineStatement(
        'CREATE UNIQUE INDEX "devices_connection_unit_key" ON "devices" USING btree ("connection_id","unit_id");',
      ),
    ).toMatchObject({ kind: "index", name: "devices_connection_unit_key" });
  });

  test("a statement it cannot type is REFUSED, never skipped and never guessed", () => {
    // The whole safety of the selective apply rests on this: an unrecognised
    // statement must stop the upgrade rather than be run blindly over a
    // database that may already have the object, or skipped silently.
    expect(() => classifyBaselineStatement("CREATE TYPE \"role\" AS ENUM ('a');")).toThrow(
      /cannot classify/i,
    );
  });
});

describe("baselinePlan", () => {
  test("every statement in the shipped baseline can be classified", () => {
    // Pinned against the real file, so a future baseline that adds a statement
    // shape this module cannot type fails HERE rather than mid-upgrade on the
    // one production instance.
    const file = readFileSync(join(import.meta.dir, "migrations", "0000_baseline.sql"), "utf8");
    const statements = file
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(statements.length).toBeGreaterThan(30);
    for (const statement of statements) {
      expect(() => classifyBaselineStatement(statement)).not.toThrow();
    }
  });

  test("an empty database runs the whole baseline", () => {
    const statements = [
      'CREATE TABLE "plants" (\n\t"id" smallint\n);',
      'CREATE INDEX "i" ON "plants" USING btree ("id");',
    ];
    const plan = baselinePlan(statements, state());
    expect(plan.run).toEqual(statements);
    expect(plan.skipped).toEqual([]);
    expect(plan.refusals).toEqual([]);
  });

  test("a table 1.2.0 already has is skipped, its constraints and indexes too", () => {
    const plan = baselinePlan(
      [
        'CREATE TABLE "user" (\n\t"id" text,\n\t"name" text,\n\t"email" text\n);',
        'CREATE TABLE "plants" (\n\t"id" smallint\n);',
        'ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id");',
        'CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");',
        'CREATE INDEX "devices_plant_role_idx" ON "devices" USING btree ("plant_id","role");',
      ],
      LEGACY_120,
    );
    expect(plan.run).toEqual([
      'CREATE TABLE "plants" (\n\t"id" smallint\n);',
      'CREATE INDEX "devices_plant_role_idx" ON "devices" USING btree ("plant_id","role");',
    ]);
    expect(plan.skipped).toHaveLength(3);
    expect(plan.refusals).toEqual([]);
  });

  test("an EXISTING table missing a column the baseline declares is a REFUSAL", () => {
    // Skipping it would leave a table the app's queries name columns on, with
    // a journal that records the baseline as applied. Loud beats silent.
    const plan = baselinePlan(
      ['CREATE TABLE "user" (\n\t"id" text,\n\t"nickname" text\n);'],
      LEGACY_120,
    );
    expect(plan.run).toEqual([]);
    expect(plan.refusals).toHaveLength(1);
    expect(plan.refusals[0]).toContain("user");
    expect(plan.refusals[0]).toContain("nickname");
  });

  test("extra columns on an existing table are fine — 1.x may have more", () => {
    const plan = baselinePlan(['CREATE TABLE "user" (\n\t"id" text\n);'], LEGACY_120);
    expect(plan.refusals).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
  });

  test("the legacy metrics_raw is NOT skipped once it has been renamed away", () => {
    const renamed = state({
      relations: ["metrics_raw_legacy"],
      columns: [["metrics_raw_legacy", new Set(["time", "inverter_id", "metric", "value"])]],
    });
    const create = 'CREATE TABLE "metrics_raw" (\n\t"time" timestamp,\n\t"device_id" smallint\n);';
    expect(baselinePlan([create], renamed).run).toEqual([create]);
  });
});

describe("replayEnd", () => {
  const cutover = new Date("2026-08-27T09:00:00Z");

  test("the replay stops where the retained raw begins, so nothing double-writes", () => {
    const rawFrom = new Date("2026-08-20T00:00:00Z");
    expect(replayEnd(rawFrom, cutover).toISOString()).toBe(rawFrom.toISOString());
  });

  test("an empty legacy raw window makes the replay run all the way to the cutover", () => {
    // Retention can have dropped every raw chunk (an addon stopped for a week).
    // Stopping at "no raw" would silently drop the most recent history.
    expect(replayEnd(null, cutover).toISOString()).toBe(cutover.toISOString());
  });

  test("raw that reaches past the cutover still stops the replay at the raw start", () => {
    const rawFrom = new Date("2026-08-27T10:00:00Z");
    expect(replayEnd(rawFrom, cutover).toISOString()).toBe(cutover.toISOString());
  });
});

describe("cadenceMs", () => {
  test("a fixed cadence is carried exactly", () => {
    expect(cadenceMs([60_000, 60_000, 60_000])).toBe(60_000);
  });

  test("the median wins, so one long gap does not stretch every row", () => {
    expect(cadenceMs([1000, 1000, 1000, 3_600_000])).toBe(1000);
  });

  test("no samples means no duration rather than a fabricated one", () => {
    expect(cadenceMs([])).toBeNull();
  });

  test("zero and negative gaps are not durations", () => {
    expect(cadenceMs([0, 0, -5])).toBeNull();
  });

  test("a cadence longer than an hour is not a poll cadence and is refused", () => {
    expect(cadenceMs([7_200_000, 7_200_000])).toBeNull();
  });
});

describe("horizonProblem", () => {
  const horizon = {
    from: new Date("2026-08-27T09:00:00Z"),
    reason: "migration-pending" as const,
  };

  test("a window that starts before the horizon is refused, not answered partly", () => {
    // A month-to-date figure whose window opens before the cutover returns a
    // real but INCOMPLETE number, which reads as authoritative.
    const problem = horizonProblem(
      { from: new Date("2026-08-01T00:00:00Z"), to: new Date("2026-08-28T00:00:00Z") },
      horizon,
    );
    expect(problem).not.toBeNull();
    expect(problem?.reason).toBe("migration-pending");
    expect(problem?.boundary.toISOString()).toBe("2026-08-27T09:00:00.000Z");
    expect(problem?.message).toContain("2026-08-27");
  });

  test("a window that starts exactly at the horizon is complete", () => {
    expect(
      horizonProblem({ from: horizon.from, to: new Date("2026-08-28T00:00:00Z") }, horizon),
    ).toBeNull();
  });

  test("a window entirely after the horizon is complete", () => {
    expect(
      horizonProblem(
        { from: new Date("2026-08-27T12:00:00Z"), to: new Date("2026-08-28T00:00:00Z") },
        horizon,
      ),
    ).toBeNull();
  });

  test("a window entirely BEFORE the horizon is refused too, not answered empty", () => {
    // The empty answer is the honest-looking one and the most misleading: a
    // chart of last July renders a flat zero line rather than saying why.
    const problem = horizonProblem(
      { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-31T00:00:00Z") },
      horizon,
    );
    expect(problem).not.toBeNull();
  });

  test("no horizon means nothing is missing and nothing is refused", () => {
    expect(
      horizonProblem(
        { from: new Date("2020-01-01T00:00:00Z"), to: new Date("2026-08-28T00:00:00Z") },
        null,
      ),
    ).toBeNull();
  });

  test("a retention horizon says retention, not migration — same defect, two causes", () => {
    const problem = horizonProblem(
      { from: new Date("2019-01-01T00:00:00Z"), to: new Date("2026-08-28T00:00:00Z") },
      { from: new Date("2021-08-27T00:00:00Z"), reason: "retention" },
    );
    expect(problem?.reason).toBe("retention");
  });

  test("a zero-width window at the horizon is not a partial window", () => {
    expect(horizonProblem({ from: horizon.from, to: horizon.from }, horizon)).toBeNull();
  });
});

describe("LEGACY_NAME", () => {
  test("nothing maps onto a name 2.0.0's baseline creates", () => {
    // A legacy name that collided with a 2.0.0 relation would make the baseline
    // fail on a duplicate — the exact failure the rename exists to avoid.
    const baseline = new Set(["metrics_raw", "minute_rollups", "hourly_rollups", "daily_rollups"]);
    for (const target of Object.values(LEGACY_NAME)) {
      expect(baseline.has(target)).toBe(false);
    }
  });
});

describe("historyHorizon", () => {
  const now = new Date("2026-08-27T12:00:00Z");

  test("a young install has no horizon: nothing is missing, it just has not run long", () => {
    // The trap this avoids: making `min(time)` the horizon would refuse a
    // "this year" chart on an install that started in March.
    expect(historyHorizon({ now, retentionDays: 1825, migrationFrom: null })?.reason).toBe(
      "retention",
    );
    expect(historyHorizon({ now, retentionDays: null, migrationFrom: null })).toBeNull();
  });

  test("retention sets the horizon at now minus drop_after", () => {
    const horizon = historyHorizon({ now, retentionDays: 90, migrationFrom: null });
    expect(horizon?.reason).toBe("retention");
    expect(horizon?.from.toISOString()).toBe("2026-05-29T12:00:00.000Z");
  });

  test("a pending migration sets the horizon at the cutover", () => {
    const cutover = new Date("2026-08-27T09:00:00Z");
    const horizon = historyHorizon({ now, retentionDays: null, migrationFrom: cutover });
    expect(horizon).toEqual({ from: cutover, reason: "migration-pending" });
  });

  test("the MORE restrictive of the two wins, and says which it is", () => {
    const cutover = new Date("2026-08-27T09:00:00Z");
    // The cutover is hours ago; retention reaches back years. The cutover wins.
    expect(historyHorizon({ now, retentionDays: 1825, migrationFrom: cutover })).toEqual({
      from: cutover,
      reason: "migration-pending",
    });
    // A migration finished long ago against a short retention: retention wins.
    expect(
      historyHorizon({
        now,
        retentionDays: 7,
        migrationFrom: new Date("2020-01-01T00:00:00Z"),
      })?.reason,
    ).toBe("retention");
  });

  test("a zero-day retention is a horizon of now, not 'no policy'", () => {
    // `0` and `null` mean opposite things and a `||` would conflate them.
    expect(historyHorizon({ now, retentionDays: 0, migrationFrom: null })?.from).toEqual(now);
  });

  test("a negative retention is not a policy and is ignored", () => {
    expect(historyHorizon({ now, retentionDays: -1, migrationFrom: null })).toBeNull();
  });
});
