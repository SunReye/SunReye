/**
 * Do the drizzle declarations still describe the relations the database has?
 *
 * The continuous aggregates cannot be managed by drizzle (see
 * `packages/db/src/schema/rollups.ts`), so their declarations are a
 * hand-maintained mirror of `packages/db/src/timescale/0000_baseline.sql`. Since
 * 2.0.0 two of their columns are `timescaledb_toolkit` PARTIALS
 * (`timeweightsummary`, `countersummary`) declared as opaque custom types, which
 * makes this check strictly more valuable: nothing else in the repo would notice
 * a toolkit upgrade that renamed one. Nothing else
 * checks that mirror. Without this test the typed reads built on it are typed
 * GUESSES: a renamed column in the SQL would leave the declaration describing a
 * relation that no longer exists, and the first query to touch it would fail at
 * runtime.
 *
 * `metrics_raw` is here too. It IS drizzle-managed, so drift is unlikely — but
 * it is promoted to a hypertable out of band, and this is the cheapest possible
 * proof that promotion leaves its columns alone.
 */
import { describe, expect, test } from "bun:test";
import { metricsConfigLog, metricsRaw } from "@SunReye/db/schema/metrics";
import { batteries, connections, devices, metricKeys, plants } from "@SunReye/db/schema/plants";
import { dailyRollups, hourlyRollups, minuteRollups } from "@SunReye/db/schema/rollups";
import { type ColumnShape, declaredColumns, diffColumns } from "@SunReye/db/schema-parity";
import { databaseReachable, resetTestDatabase } from "./harness";

const reachable = await databaseReachable();
if (!reachable) {
  const message = "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}

/**
 * Every relation whose drizzle declaration must match the database. Adding a
 * declaration without adding it here would reintroduce exactly the unverified
 * mirror this file exists to remove.
 */
const RELATIONS = [
  { name: "metrics_raw", relation: metricsRaw },
  { name: "metrics_config_log", relation: metricsConfigLog },
  { name: "minute_rollups", relation: minuteRollups },
  { name: "hourly_rollups", relation: hourlyRollups },
  { name: "daily_rollups", relation: dailyRollups },
  // The dimensions. Drizzle-managed, so drift is unlikely — but the int2
  // identity is only as good as the tables it resolves against, and a
  // hand-written `smallint` that generated as `integer` would silently double
  // the width of every reading's key.
  { name: "plants", relation: plants },
  { name: "connections", relation: connections },
  { name: "devices", relation: devices },
  { name: "batteries", relation: batteries },
  { name: "metric_keys", relation: metricKeys },
] as const;

const suite = reachable ? describe : describe.skip;

suite("drizzle declarations match the live schema", () => {
  let actualByRelation: Map<string, ColumnShape[]>;

  test("bootstrap: bring a scratch database to the shipped schema", async () => {
    const url = await resetTestDatabase();
    const { createDbAt } = await import("@SunReye/db");
    const db = createDbAt(url);
    const { sql } = await import("drizzle-orm");
    // An `IN` list of individual parameters rather than `= any($1)`: an array
    // bound through this driver arrives as the string "a,b" and Postgres rejects
    // it as a malformed array literal.
    const names = sql.join(
      RELATIONS.map((r) => sql`${r.name}`),
      sql`, `,
    );

    // Continuous aggregates are not in `information_schema.columns` under their
    // own name on every TimescaleDB version, so read from pg_attribute, which
    // describes whatever relkind the aggregate presents as.
    const rows = await db.execute<{ relation: string; column_name: string; data_type: string }>(sql`
      select c.relname as relation,
             a.attname as column_name,
             format_type(a.atttypid, a.atttypmod) as data_type
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
      where n.nspname = 'public'
        and a.attnum > 0
        and not a.attisdropped
        and c.relname in (${names})
      order by c.relname, a.attnum
    `);

    actualByRelation = new Map();
    for (const row of rows.rows) {
      const list = actualByRelation.get(row.relation) ?? [];
      // `format_type` spells these as Postgres does in DDL; drizzle's
      // `getSQLType()` uses the same spelling.
      list.push({ name: row.column_name, dataType: row.data_type });
      actualByRelation.set(row.relation, list);
    }
    expect(actualByRelation.size).toBeGreaterThan(0);
  });

  for (const { name, relation } of RELATIONS) {
    test(`${name} matches its declaration`, () => {
      const problems = diffColumns(
        name,
        declaredColumns(relation),
        actualByRelation.get(name) ?? [],
      );
      expect(problems).toEqual([]);
    });
  }
});
