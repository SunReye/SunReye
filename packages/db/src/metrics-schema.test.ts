import { describe, expect, test } from "bun:test";
import { getTableColumns, getTableName } from "drizzle-orm";

import { metricsConfigLog, metricsRaw } from "./schema/metrics";

/**
 * The config change-log's shape is the whole point of the table, so it is
 * asserted rather than assumed.
 *
 * One directory up from the schema it pins, deliberately: `drizzle-kit` loads
 * every file under the `schema` path in `drizzle.config.ts`, so a co-located
 * `*.test.ts` importing `bun:test` crashes `db:generate` before it can read a
 * single table.
 *
 * The alternative that was rejected is what these tests guard against: keeping
 * the record in `app_settings`. `readSetting` safe-parses to the default with no
 * log, so a schema change there silently wipes the record it is meant to
 * preserve — the same reason device mappings are forbidden from that table. A
 * typed column per field cannot lose a row to a parse: a column the code stops
 * reading still holds its values, and one it reads that is missing is an error
 * at migration time, not silence at read time.
 */
describe("metrics_config_log", () => {
  const columns = getTableColumns(metricsConfigLog);

  test("is its own table, not a row in the settings blob", () => {
    expect(getTableName(metricsConfigLog)).toBe("metrics_config_log");
  });

  test("carries one typed, non-null column per field", () => {
    expect(Object.keys(columns).sort()).toEqual(["inverterId", "metric", "time", "value"]);
    for (const [name, column] of Object.entries(columns)) {
      expect(column.notNull, `${name} must be NOT NULL`).toBe(true);
    }
  });

  test("stores no serialized blob — a value survives a schema change it is not part of", () => {
    // A `json`/`jsonb` payload is where a silent reset becomes possible: the
    // parse happens on read, so a shape change discards what it cannot
    // understand. Columns cannot do that.
    const types = Object.values(columns).map((c) => c.columnType);
    expect(types.some((t) => /Json/i.test(t))).toBe(false);
  });

  test("mirrors the timeseries table's identity columns, so the two are joinable", () => {
    // The change-log answers "what was the limit while this happened" against
    // `metrics_raw`; that only works if the row identifies the device and metric
    // the same way.
    const raw = getTableColumns(metricsRaw);
    expect(columns.inverterId.name).toBe(raw.inverterId.name);
    expect(columns.metric.name).toBe(raw.metric.name);
    expect(columns.value.columnType).toBe(raw.value.columnType);
  });
});

/**
 * `dur_ms` is the weight the continuous aggregates multiply `value` by: how long
 * this row's value was held, in milliseconds, starting at the row's own `time`.
 *
 * It exists because a change-only writer (#117) breaks the one property the
 * plain `avg(value)` in the rollups silently relied on — that every stored
 * sample represents an equal slice of time. Once only *changes* are stored, a
 * metric flat at 0 for 50 minutes contributes one row and a 10-minute spike
 * contributes hundreds, so an unweighted mean reports something close to the
 * spike (#116).
 */
describe("metrics_raw.dur_ms", () => {
  const columns = getTableColumns(metricsRaw);

  test("exists as the weight column the weighted rollups read", () => {
    expect(columns.durMs?.name).toBe("dur_ms");
  });

  test("is nullable: NULL means 'this row predates weighting', not a duration", () => {
    // Every row written before #117 has no recorded hold time. The aggregates
    // read NULL as an equal weight (`coalesce(dur_ms, 1000)`), which makes the
    // weighted mean exactly equal to the old plain mean over a complete series —
    // the property that makes this migration safe.
    expect(columns.durMs?.notNull).toBe(false);
  });

  test("has no default — 'not applicable' is never spelled as a number", () => {
    // A DEFAULT of 0 would be a zero-width interval (a row that weighs nothing);
    // a DEFAULT of 1 would claim a 1 ms hold the writer never measured. Both are
    // numbers standing in for "unknown", which this repo forbids.
    expect(columns.durMs?.hasDefault).toBe(false);
    expect(columns.durMs?.default).toBeUndefined();
  });

  test("is an integer, not a float: milliseconds are counted, not measured", () => {
    expect(columns.durMs?.columnType).toBe("PgInteger");
  });

  test("is not on the config change-log — a setting has no time-weighted mean", () => {
    expect(getTableColumns(metricsConfigLog)).not.toHaveProperty("durMs");
  });
});
