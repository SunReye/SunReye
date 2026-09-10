/**
 * The SQL that only CI runs, checked against the schema it will run against.
 *
 * Two workflows seed a spine by hand — `db-restore.yml` before its dump/restore
 * round trip, `upgrade-test.yml` after the upgrade, to prove the new generation
 * still materializes. Both wrote `INSERT INTO connections (plant_id, name, host)`,
 * and migration 0006 (#217) moved the Modbus endpoint into `params` and dropped
 * `host`, `port`, `transport`, `timeout_ms` and `poll_interval_ms`. Nothing in
 * the repo noticed: the unit suite never reads a workflow, the database suite
 * runs its own migrations, and the failure surfaces only as a red job minutes
 * into a container boot — which is exactly how it was found.
 *
 * This is a source-text test and therefore not coverage (`apps/web/TESTING.md`
 * says why). It is the only layer available: the statements live in YAML that
 * only GitHub executes. What it pins is narrow and mechanical — a seed must not
 * name a column the schema no longer has.
 */

import { describe, expect, test } from "bun:test";

const REPO = new URL("../", import.meta.url);

/** Columns migration 0006 dropped from `connections`, and must never reappear. */
const DROPPED = ["host", "port", "transport", "timeout_ms", "poll_interval_ms"] as const;

const WORKFLOWS = [".github/workflows/db-restore.yml", ".github/workflows/upgrade-test.yml"];

async function read(file: string): Promise<string> {
  return await Bun.file(new URL(file, REPO)).text();
}

/**
 * Every `INSERT INTO connections (...)` column list in a file.
 *
 * Only the column list: the SELECT that feeds it names `host` as a *value*
 * (`'127.0.0.1'`), and a naive substring search over the statement would flag
 * a correct seed forever.
 */
function connectionInsertColumns(sql: string): string[][] {
  return [...sql.matchAll(/insert\s+into\s+connections\s*\(([^)]*)\)/gi)].map((m) =>
    m[1]!.split(",").map((c) => c.trim().toLowerCase()),
  );
}

describe("a workflow's hand-written spine matches the current schema", () => {
  test.each(WORKFLOWS)("%s seeds connections by kind and params, not by column", async (file) => {
    const sql = await read(file);
    const inserts = connectionInsertColumns(sql);
    // The discovery half: a regex that quietly stops matching passes as green
    // as one that holds, and this file exists because these two seeds were
    // wrong for a whole schema version.
    expect(inserts.length).toBeGreaterThan(0);
    for (const columns of inserts) {
      for (const dropped of DROPPED) expect(columns).not.toContain(dropped);
      expect(columns).toContain("params");
    }
  });

  // `upgrade-test.yml` also shapes a PRE-upgrade database from an old tag, where
  // `host` is still the right column — but it does that by running the OLD
  // tree's migrator, never by writing the columns itself. If a hand-written
  // pre-upgrade seed ever appears, the rule above would be wrong for it, so
  // this pins the shape the rule depends on.
  test("the pre-upgrade database is shaped by the old tag's migrator, not by hand", async () => {
    const sql = await read(".github/workflows/upgrade-test.yml");
    expect(sql).toContain("bun run --cwd /tmp/pre-upgrade/packages/db db:migrate");
  });
});
