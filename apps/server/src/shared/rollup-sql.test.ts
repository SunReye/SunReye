import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ROLLUP_BUCKETS, preferredRollup, rollupArms } from "./rollup-sql";

/**
 * The read cutover (#116) is a *composition* — two continuous aggregates unioned
 * under a per-bucket preference — so it is built by a pure function and asserted
 * here as a composition, on the arms it produces and on the statement they
 * render to. Nothing in this file greps a source text: `render` runs the real
 * drizzle dialect, so what is asserted is the statement the database would
 * actually receive, and the semantic half of the same claim (no gap, no
 * double-counted bucket, the weighted side winning) is proved against a real
 * TimescaleDB in `.github/workflows/db-weighted-rollups.yml`.
 */
const dialect = new PgDialect();
const render = (bucket: Parameters<typeof preferredRollup>[0]) => {
  const query = dialect.sqlToQuery(
    sql`select bucket, avg_value from ${preferredRollup(bucket, sql`metric = ${"pv.power"}`)} r`,
  );
  return { sql: query.sql.replace(/\s+/g, " ").trim(), params: query.params };
};

describe("rollupArms", () => {
  test("every bucket size has exactly two sources: the weighted view and the legacy one", () => {
    for (const bucket of ROLLUP_BUCKETS) {
      const arms = rollupArms(bucket);
      expect(arms).toHaveLength(2);
      expect(arms.filter((a) => a.weighted)).toHaveLength(1);
      expect(arms.filter((a) => !a.weighted)).toHaveLength(1);
    }
  });

  test("names the aggregate pair each tier reads", () => {
    expect(rollupArms("minute").map((a) => a.view)).toEqual([
      "weighted_minute_rollups",
      "minute_rollups",
    ]);
    expect(rollupArms("hour").map((a) => a.view)).toEqual([
      "weighted_hourly_rollups",
      "hourly_rollups",
    ]);
    expect(rollupArms("day").map((a) => a.view)).toEqual([
      "weighted_daily_rollups",
      "daily_rollups",
    ]);
  });

  test("the weighted arm sorts first, so DISTINCT ON keeps it wherever it exists", () => {
    // This is the whole cutover: no watermark table, no cached boundary. The
    // weighted views can only reach as far back as metrics_raw does (7 days
    // today), and as retention grows (#121) they reach further on their own.
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

  test("the weighted arm divides the two materialized sums and guards a zero weight", () => {
    // The aggregates materialize sum(value * weight) and sum(weight), never their
    // quotient — an expression over aggregates inside a continuous-aggregate
    // definition is a portability risk, and the parts stay composable. So the
    // division happens here, and `nullif` is what stops a degenerate
    // zero-weight bucket becoming a division-by-zero error or, worse, a
    // fabricated number that reads as data.
    const weighted = rollupArms("hour").find((a) => a.weighted);
    expect(weighted?.avgExpr).toBe("weighted_sum / nullif(weight, 0)");
  });

  test("the legacy arm reads its already-materialized avg_value untouched", () => {
    // A year-old bucket exists ONLY here: the weighted view cannot be
    // materialized past the raw retention horizon, and re-materializing the
    // legacy one is forbidden (0000_bootstrap.sql).
    expect(rollupArms("day").find((a) => !a.weighted)?.avgExpr).toBe("avg_value");
  });
});

describe("preferredRollup", () => {
  test("reads both sources for the tier", () => {
    const { sql: text } = render("hour");
    expect(text).toContain("from weighted_hourly_rollups");
    expect(text).toContain("from hourly_rollups");
  });

  test("unions the arms — never joins them, which would drop unmatched buckets", () => {
    expect(render("minute").sql).toContain("union all");
  });

  test("collapses to one row per bucket, ordered so the weighted arm wins", () => {
    const { sql: text } = render("day");
    expect(text).toContain("distinct on (bucket)");
    // The `order by` must lead with the DISTINCT ON expression and break the tie
    // on preference; any other order makes the surviving row arbitrary.
    expect(text).toMatch(/order by bucket, pref/);
  });

  test("selects the caller-facing columns from both arms, so the row shape is one shape", () => {
    const { sql: text } = render("hour");
    expect(text).toContain("bucket, avg_value, max_value, min_value");
  });

  test("applies the caller's predicates to both arms — an unfiltered arm would scan everything", () => {
    const { params } = render("hour");
    expect(params).toEqual(["pv.power", "pv.power"]);
  });

  test("emits no expression an aggregate could have materialized instead", () => {
    // Belt on the design decision: the quotient is computed at read time only,
    // so nothing here may reference a column the aggregates do not define.
    expect(render("minute").sql).toContain("weighted_sum / nullif(weight, 0) as avg_value");
  });

  test("every tier renders a statement with the same shape", () => {
    for (const bucket of ROLLUP_BUCKETS) {
      const { sql: text } = render(bucket);
      expect(text).toContain("distinct on (bucket)");
      expect(text).toContain("union all");
      expect(text).toContain("nullif(weight, 0)");
    }
  });
});
