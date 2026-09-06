import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { getViewName, sql } from "drizzle-orm";
import { declaredColumns } from "@SunReye/db/schema-parity";
import { dailyRollups, hourlyRollups, minuteRollups } from "@SunReye/db/schema/rollups";
import { ROLLUP_BUCKETS, plantRollupSeries, rollupSeries, rollupTier } from "./rollup-sql";

/**
 * A tier now has exactly ONE source, so this file no longer asserts a
 * composition of competing arms — it asserts the SHAPE of the one statement each
 * tier renders. `render` runs the real drizzle dialect, so what is checked is
 * what the database would receive, and the semantic half (that the numbers are
 * right across a bucket boundary) is proved against a real TimescaleDB in
 * `apps/server/db-tests/`.
 *
 * `ROLLUP_BUCKETS` is the exhaustiveness seam: every `describe("every tier")`
 * case iterates it, so a fourth tier cannot be added without a test covering it.
 */
const dialect = new PgDialect();
const FROM = new Date("2026-01-01T00:00:00Z");
const TO = new Date("2026-01-08T00:00:00Z");
const render = (
  bucket: Parameters<typeof rollupSeries>[0],
  window: Partial<Parameters<typeof rollupSeries>[1]> = {},
) => {
  const query = dialect.sqlToQuery(
    sql`select bucket, avg_value from ${rollupSeries(bucket, {
      metric: "pv.power",
      inverterId: "deye-1",
      from: FROM,
      ...window,
    })} r`,
  );
  return { sql: query.sql.replace(/\s+/g, " ").trim(), params: query.params };
};

describe("rollupTier", () => {
  test("every tier reads a relation the drizzle declarations name", () => {
    // Not literals here: those declarations are checked against the live
    // relations by apps/server/db-tests/schema-parity.test.ts, so a rename in
    // packages/db/src/timescale/*.sql cannot leave this module addressing a
    // relation that no longer exists — which a string literal silently would.
    const declared = new Set<string>([
      getViewName(minuteRollups),
      getViewName(hourlyRollups),
      getViewName(dailyRollups),
    ]);
    for (const bucket of ROLLUP_BUCKETS) expect(declared).toContain(rollupTier(bucket).view);
  });

  test("each tier maps to its own aggregate, with no pair and no fallback", () => {
    // 1.x carried two generations per tier and a per-bucket preference rule to
    // pick between them. 2.0.0 has one aggregate per tier that is right from
    // birth; if this ever grows a second source again, that is a new generation.
    expect(ROLLUP_BUCKETS.map((b) => rollupTier(b).view)).toEqual([
      "minute_rollups",
      "hourly_rollups",
      "daily_rollups",
    ]);
  });

  test("the widths are the widths the aggregates bucket by", () => {
    expect(ROLLUP_BUCKETS.map((b) => rollupTier(b).width)).toEqual(["1 minute", "1 hour", "1 day"]);
    expect(ROLLUP_BUCKETS.map((b) => rollupTier(b).ms)).toEqual([60_000, 3_600_000, 86_400_000]);
  });

  test("only the hourly and daily tiers carry a counter partial", () => {
    // A CounterSummary is 184 B, so a minute bucket per metric per device is
    // ~28 MB/device-day — the hot window this release exists to shrink. Counter
    // reads at minute resolution go to raw, which still has every sample.
    expect(rollupTier("minute").counters).toBe(false);
    expect(rollupTier("hour").counters).toBe(true);
    expect(rollupTier("day").counters).toBe(true);
  });
});

describe("the average is interpolated, never plain", () => {
  test("uses interpolated_average with the tier's own width and both neighbours", () => {
    // THE bug this release exists to fix. `average(tw)` over a bucket holding a
    // single sample is NULL — a point has no duration — and a change-only writer
    // leaves most buckets holding one sample or none. `interpolated_average`
    // brings in the neighbouring partials, which is also what attributes a value
    // held across midnight to BOTH buckets in proportion. Proved numerically
    // (100 held from 23:50, 200 from 00:10 → 183.333… for the 00:00 hour) in
    // apps/server/db-tests/baseline.test.ts.
    const { sql: text } = render("hour");
    expect(text).toContain("interpolated_average(tw, bucket, '1 hour'::interval");
    expect(text).toContain("lag(tw) over w");
    expect(text).toContain("lead(tw) over w");
    expect(text).toContain("window w as (order by bucket)");
  });

  test("never emits a plain average(tw), at any tier", () => {
    for (const bucket of ROLLUP_BUCKETS) {
      expect(render(bucket).sql).not.toMatch(/[^_]average\(tw\)/);
    }
  });

  test("references only columns the aggregate actually declares", () => {
    // The expression cannot be built from qualified column objects (it is one
    // string shared by all three tiers), so this is what stops its column names
    // from drifting away from the aggregates.
    const columns = new Set(declaredColumns(hourlyRollups).map((c) => c.name));
    for (const id of ["tw", "bucket", "max_value", "min_value"]) expect(columns).toContain(id);
  });
});

describe("the window", () => {
  test("filters on the identity by ID, with the caller's NAMES bound as parameters", () => {
    // Names stay the API vocabulary; the int2 is resolved at the boundary. The
    // metric key and the source id must therefore appear as bound parameters and
    // the columns as `device_id` / `metric_id`.
    const { sql: text, params } = render("hour");
    expect(text).toContain("device_id =");
    expect(text).toContain("metric_id =");
    expect(text).not.toContain("inverter_id");
    expect(params).toContain("pv.power");
    expect(params).toContain("deye-1");
  });

  test("reads one bucket beyond each end, then trims back to the exact window", () => {
    // `lag`/`lead` can only see rows the inner query returned, so a window
    // trimmed before the window function runs would leave the FIRST bucket with
    // no predecessor and the LAST with no successor — exactly the two buckets a
    // chart's edges are made of.
    const { sql: text, params } = render("hour", { to: TO });
    // Compared as instants: a bound Date parameter is a distinct object, so
    // `toContain` on the array itself would compare by identity and never match.
    const bound = params.map((p) => (p instanceof Date ? p.getTime() : p));
    expect(bound).toContain(FROM.getTime() - 3_600_000);
    expect(bound).toContain(TO.getTime() + 3_600_000);
    // …and the exact bounds are still applied, outside.
    expect(bound).toContain(FROM.getTime());
    expect(bound).toContain(TO.getTime());
    expect(text).toMatch(/\) s where bucket >= \$\d+ and bucket < \$\d+ \)/);
  });

  test("an open-ended window has no upper bound at all", () => {
    const { sql: text } = render("hour");
    expect(text).not.toContain("bucket <");
  });

  test("widens by the tier's OWN width, not a fixed interval", () => {
    const { params } = render("day", { to: TO });
    const bound = params.map((p) => (p instanceof Date ? p.getTime() : p));
    expect(bound).toContain(FROM.getTime() - 86_400_000);
  });
});

describe("every tier", () => {
  test("renders the caller-facing row shape, one shape for all three", () => {
    for (const bucket of ROLLUP_BUCKETS) {
      expect(render(bucket).sql).toContain("select bucket, avg_value, max_value, min_value");
    }
  });

  test("applies the caller's metric and source id exactly once — one source, one arm", () => {
    for (const bucket of ROLLUP_BUCKETS) {
      const { params } = render(bucket);
      expect(params.filter((p) => p === "pv.power")).toHaveLength(1);
      // Twice: `deviceIdOf` tries the slug and then the profile id, binding both.
      expect(params.filter((p) => p === "deye-1")).toHaveLength(2);
    }
  });

  test("emits no union and no per-bucket preference — there is nothing to prefer", () => {
    for (const bucket of ROLLUP_BUCKETS) {
      const { sql: text } = render(bucket);
      expect(text).not.toContain("union all");
      expect(text).not.toContain("distinct on");
    }
  });

  test("interpolates at every tier, including minute", () => {
    for (const bucket of ROLLUP_BUCKETS) {
      expect(render(bucket).sql).toContain("interpolated_average(tw, bucket,");
    }
  });
});

describe("plantRollupSeries — the fold across a plant's devices", () => {
  const renderPlant = (
    aggregate: Parameters<typeof plantRollupSeries>[1]["aggregate"],
    members = [
      { id: 1, slug: "inv-1", weight: 10 },
      { id: 2, slug: "inv-2", weight: 5 },
    ],
  ) => {
    const query = dialect.sqlToQuery(
      sql`select bucket, avg_value from ${plantRollupSeries("hour", {
        metric: "battery.soc",
        members,
        aggregate,
        from: FROM,
        to: TO,
      })} r`,
    );
    return { sql: query.sql.replace(/\s+/g, " ").trim(), params: query.params };
  };

  test("the device set is an IN list of ids, each bound", () => {
    const { sql: text, params } = renderPlant("sum");
    expect(text).toContain("device_id in ($");
    expect(params).toContain(1);
    expect(params).toContain(2);
  });

  test("interpolation is per device: the window partitions by device_id", () => {
    expect(renderPlant("sum").sql).toContain("partition by device_id order by bucket");
  });

  test("`sum` folds avg, max and min by addition, grouped per bucket", () => {
    const { sql: text } = renderPlant("sum");
    expect(text).toContain("sum(avg_value) as avg_value");
    expect(text).toContain("sum(max_value) as max_value");
    expect(text).toContain("sum(min_value) as min_value");
    expect(text).toMatch(/group by bucket \) r$/);
  });

  test("`weighted-mean` weights each device's mean by its member weight", () => {
    const { sql: text, params } = renderPlant("weighted-mean");
    expect(text).toContain("sum(avg_value * w.weight) / sum(w.weight) as avg_value");
    // Extrema of a mean are the member extrema, not their sum.
    expect(text).toContain("max(max_value) as max_value");
    expect(text).toContain("min(min_value) as min_value");
    expect(params).toContain(10);
    expect(params).toContain(5);
  });

  test("an EMPTY member set renders `where false`, never the syntax error `in ()`", () => {
    const { sql: text } = renderPlant("sum", []);
    expect(text).toContain("where false");
    expect(text).not.toContain("in ()");
  });

  test("the metric key is still resolved by name, bound", () => {
    const { params } = renderPlant("sum");
    expect(params).toContain("battery.soc");
  });
});
