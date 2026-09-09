/**
 * `readLegacyCadenceMs` against a database that has no legacy schema.
 *
 * WHY THIS IS A DATABASE SPEC
 *
 * The question is not what the function computes — the arithmetic has unit
 * cover. The question is what POSTGRES does when the relation the query names
 * does not exist, and the answer is that it refuses the statement before
 * executing a row of it. No unit double can tell you that, and a SQL-text
 * assertion would have passed happily while #181 shipped.
 *
 * TWO HEALTHY DATABASES REACH THIS WITH NO LEGACY SCHEMA:
 *
 *  * a FRESH 2.0.0 install, which never had a `metrics_raw_legacy` — this is
 *    what #181 reported, an ERROR in the log of a database behaving perfectly;
 *  * an UPGRADED install past `verified`, where the legacy hypertable and its
 *    aggregates have been DROPPED on purpose. The record says the work is done,
 *    but the cadence is read before the driver is asked, so a button press still
 *    went looking for a table the upgrade deliberately removed.
 *
 * The first is fenced off a layer up, in `runMigrationBackfill` (stage `none`
 * opens no connection at all). The second cannot be — the record says a real
 * migration happened — so the function itself has to answer rather than throw.
 * `null` is already its "no measurable cadence" answer, and an absent relation
 * is exactly that.
 */
import { describe, expect, test } from "bun:test";
import { withUpgradeClient } from "@SunReye/db/upgrade-connect";
import { readLegacyCadenceMs } from "@SunReye/db/upgrade-120-run";
import { databaseReachable, resetTestDatabase } from "./harness";

const reachable = await databaseReachable();
if (!reachable) {
  const message = "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}
const suite = reachable ? describe : describe.skip;

suite("the legacy cadence on a database with no legacy schema", () => {
  // One reset for both cases: the database is shared and rebuilding it is the
  // expensive part of this layer, so a second reset would buy nothing — neither
  // test writes anything.
  let url = "";
  test("setup: a fresh 2.0.0 database", async () => {
    url = await resetTestDatabase();
    expect(url).toContain("sunreye_dbtest");
  });

  test("the premise: a fresh install has no metrics_raw_legacy at all", async () => {
    // Stated rather than assumed. If a future baseline ever created this
    // relation, the test below would pass for the wrong reason.
    const present = await withUpgradeClient(url, async (client) => {
      const result = await client.query(
        `select count(*)::int as n from information_schema.tables
          where table_name = 'metrics_raw_legacy'`,
      );
      return Number((result.rows[0] as { n: unknown } | undefined)?.n ?? -1);
    });
    expect(present).toBe(0);
  });

  test("reads as null rather than raising, so a healthy install logs no error", async () => {
    const cadence = await withUpgradeClient(url, (client) => readLegacyCadenceMs(client));
    expect(cadence).toBeNull();
  });
});
