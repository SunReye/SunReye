import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ROLLUP_BUCKETS, preferredRollup, rollupArms } from "./rollup-sql";

/**
 * The read cutover (#116) is a *composition* — the sources for a tier unioned
 * under a per-bucket preference — so it is built by a pure function and asserted
 * here as a composition, on the arms it produces and on the statement they
 * render to. Nothing in this file greps a source text: `render` runs the real
 * drizzle dialect, so what is asserted is the statement the database would
 * actually receive, and the semantic half of the same claim (no gap, no
 * double-counted bucket, the weighted side winning) is proved against a real
 * TimescaleDB in `.github/workflows/db-weighted-rollups.yml`.
 *
 * The minute tier has three arms rather than two since the minute aggregates
 * stopped being refreshed: raw answers every bucket it covers, and the two
 * frozen aggregates answer the ones materialized before the freeze, until
 * retention ages them out.
 */
const dialect = new PgDialect();
const FROM = new Date("2026-01-01T00:00:00Z");
const TO = new Date("2026-01-08T00:00:00Z");
const render = (
  bucket: Parameters<typeof preferredRollup>[0],
  window: Partial<Parameters<typeof preferredRollup>[1]> = {},
) => {
  const query = dialect.sqlToQuery(
    sql`select bucket, avg_value from ${preferredRollup(bucket, {
      metric: "pv.power",
      inverterId: "deye-1",
      from: FROM,
      ...window,
    })} r`,
  );
  return { sql: query.sql.replace(/\s+/g, " ").trim(), params: query.params };
};

describe("rollupArms", () => {
  test("the hour and day tiers read exactly their aggregate pair", () => {
    for (const bucket of ["hour", "day"] as const) {
      const arms = rollupArms(bucket);
      expect(arms).toHaveLength(2);
      expect(arms.filter((a) => a.weighted)).toHaveLength(1);
      expect(arms.map((a) => a.source)).toEqual(["view", "view"]);
    }
  });

  test("the minute tier reads raw first, then the two frozen aggregates", () => {
    // `policies.sql` stopped refreshing both minute aggregates: raw now holds
    // every minute bucket within its own (much longer) retention, and the
    // aggregates hold only what was materialized before the freeze. Raw is
    // preferred because it is the one source that keeps growing.
    const arms = rollupArms("minute");
    expect(arms.map((a) => a.source)).toEqual(["raw", "view", "view"]);
    expect(arms.map((a) => a.view)).toEqual([
      "metrics_raw",
      "weighted_minute_rollups",
      "minute_rollups",
    ]);
  });

  test("every minute arm but the legacy one is time-weighted", () => {
    // Raw is aggregated with the same two sums the weighted views materialize,
    // so switching a bucket from the aggregate to raw cannot change its value.
    const arms = rollupArms("minute");
    expect(arms.filter((a) => a.weighted).map((a) => a.view)).toEqual([
      "metrics_raw",
      "weighted_minute_rollups",
    ]);
  });

  test("the weighted arm sorts first, so DISTINCT ON keeps it wherever it exists", () => {
    for (const bucket of ROLLUP_BUCKETS) {
      const [first, second] = rollupArms(bucket);
      expect(first?.weighted).toBe(true);
      expect(first?.pref).toBeLessThan(second?.pref ?? Number.NEGATIVE_INFINITY);
    }
  });

  test("every arm has a distinct preference rank — a tie would make the winner arbitrary", () => {
    for (const bucket of ROLLUP_BUCKETS) {
      const prefs = rollupArms(bucket).map((a) => a.pref);
      expect(new Set(prefs).size).toBe(prefs.length);
    }
  });

  test("the weighted view arm divides the two materialized sums and guards a zero weight", () => {
    const weighted = rollupArms("hour").find((a) => a.weighted);
    expect(weighted?.avgExpr).toBe("weighted_sum / nullif(weight, 0)");
  });

  test("the legacy arm reads its already-materialized avg_value untouched", () => {
    expect(rollupArms("day").find((a) => !a.weighted)?.avgExpr).toBe("avg_value");
  });
});

describe("preferredRollup", () => {
  test("reads both sources for an aggregate-only tier", () => {
    const { sql: text } = render("hour");
    expect(text).toContain("from weighted_hourly_rollups");
    expect(text).toContain("from hourly_rollups");
  });

  test("unions the arms — never joins them, which would drop unmatched buckets", () => {
    expect(render("minute").sql).toContain("union all");
  });

  test("collapses to one row per bucket, ordered so the preferred arm wins", () => {
    const { sql: text } = render("day");
    expect(text).toContain("distinct on (bucket)");
    expect(text).toMatch(/order by bucket, pref/);
  });

  test("selects the caller-facing columns from every arm, so the row shape is one shape", () => {
    const { sql: text } = render("hour");
    expect(text).toContain("bucket, avg_value, max_value, min_value");
  });

  test("emits no expression an aggregate could have materialized instead", () => {
    expect(render("hour").sql).toContain("weighted_sum / nullif(weight, 0) as avg_value");
  });
});

describe("the raw minute arm", () => {
  test("buckets raw rows with the same time_bucket width the aggregate used", () => {
    expect(render("minute").sql).toContain("time_bucket('1 minute'::interval, \"time\")");
  });

  test("weights each row by its own dur_ms, defaulting a pre-#117 row to one second", () => {
    // Identical to the aggregates' SELECT list. A plain avg(value) over a
    // change-only series is 4.2x wrong on a measured upgrade day, and reading a
    // NULL dur_ms as anything but the shipped poll interval moves every bucket
    // that spans the storage rewrite.
    const { sql: text } = render("minute");
    expect(text).toContain("sum(value * coalesce(dur_ms, 1000))");
    expect(text).toContain("sum(coalesce(dur_ms, 1000))");
  });

  test("bounds the raw scan on `time`, not on the bucket, so chunks are excluded", () => {
    // The whole reason this arm exists rather than leaning on the frozen
    // aggregate's own real-time union: a predicate on time_bucket(time) does not
    // prune chunks, so a frozen watermark would make every minute read scan raw
    // from the freeze forward.
    const { sql: text } = render("minute", { to: TO });
    expect(text).toMatch(/"time" >= \$\d/);
    expect(text).toMatch(/"time" < \$\d/);
  });

  test("widens the scan by one bucket at each end, then filters on the bucket exactly", () => {
    // The scan bounds are generous by one bucket so a window edge that lands
    // mid-bucket still reads that bucket's whole set of rows — a truncated
    // bucket would report a max/min the minute never had. The exact bucket
    // predicate is applied after grouping, so the arm returns the same buckets
    // an aggregate arm would.
    const { sql: text } = render("minute", { to: TO });
    expect(text).toContain("bucket >= ");
    expect(text).toContain("bucket < ");
  });

  test("omits the upper bound entirely for an open-ended window", () => {
    const { sql: text } = render("minute");
    expect(text).not.toMatch(/"time" < \$\d/);
  });

  test("filters raw by metric and inverter before grouping", () => {
    const { params } = render("minute");
    expect(params.slice(0, 2)).toEqual(["pv.power", "deye-1"]);
  });
});

describe("every tier", () => {
  test("renders one row per bucket under a preference, whatever its sources", () => {
    for (const bucket of ROLLUP_BUCKETS) {
      const { sql: text } = render(bucket);
      expect(text).toContain("distinct on (bucket)");
      expect(text).toContain("union all");
    }
  });

  test("applies the caller's metric and inverter to every arm it renders", () => {
    for (const bucket of ROLLUP_BUCKETS) {
      const { params } = render(bucket);
      const arms = rollupArms(bucket).length;
      expect(params.filter((p) => p === "pv.power")).toHaveLength(arms);
      expect(params.filter((p) => p === "deye-1")).toHaveLength(arms);
    }
  });
});
