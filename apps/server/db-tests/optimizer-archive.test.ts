/**
 * THE OPTIMIZER SURVIVES A MOVE — export, import, and its decisions are still
 * there.
 *
 * Its own spec file, and its own database, for the reason `./archive.test.ts`
 * documents: the portable archive is a WHOLE-DATABASE transport, so any
 * assertion about what an export contains is really an assertion about what the
 * whole database contains, and in a shared one it silently becomes an assertion
 * about whichever spec ran first. `resetArchiveDatabase` is deliberately not
 * memoized, and the db-test layer runs serially, so each file that asks for it
 * starts from a migrated, empty 2.0.0 schema.
 *
 * What this adds to `./archive.test.ts`, which already proves energy survives a
 * round trip: the optimizer is a device with `connection_id NULL` and
 * `role = 'optimizer'` — no endpoint, no registers, no machine — and its
 * readings are DECISIONS. Before #172 they lived in an in-memory ring, so a
 * plant that moved machines or restored a backup lost every decision it had ever
 * made, and there was nothing in the archive to lose.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SQL } from "bun";
import { sql } from "drizzle-orm";

import { ensureMetricKeys } from "@SunReye/db/metric-keys";
import { type ReplayClient, bunSqlClient, metricKeyWriter } from "@SunReye/db/replay-run";
import { exportArchive } from "@SunReye/db/archive-export";
import { importArchive } from "@SunReye/db/archive-import";
import { databaseReachable, resetArchiveDatabase } from "./harness";

const reachable = await databaseReachable();
const realDb = await import("@SunReye/db");
const realDbExports = { ...realDb };

if (!reachable) {
  const message = "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}

const suite = reachable ? describe : describe.skip;

const PLANT = "opt-arch-plant";
/** The plant's inverter — so the export is not a single-device special case. */
const INVERTER = "opt-arch-inverter";
const OPTIMIZER = "optimizer";
/** Where the archive is restored, so source and restored can be compared. */
const RESTORED = "opt-arch-restored";
const DECISION = "optimizer.target.current";
const REGIME = "optimizer.price.regime";
/**
 * The operator's half of the optimizer's record: `metrics_config_log`, not the
 * hypertable. A round trip that carried only the decisions would restore a plant
 * that could say what ceiling it chose at 10:00 and not whether the automation
 * was even switched on.
 */
const ENABLED = "optimizer.enabled";
const MODE = "optimizer.mode";
const RESTORE = "optimizer.restore.pending";

suite("the optimizer round-trips through the portable archive", () => {
  let pool: SQL;
  let client: ReplayClient;
  let raw: ReturnType<typeof realDbExports.createDbAt>;
  let dir = "";
  let archivePath = "";

  beforeAll(async () => {
    const url = await resetArchiveDatabase();
    raw = realDbExports.createDbAt(url);
    // `max: 1`, never a pool: the replay's chunk transaction is `begin`/`commit`
    // statements, and on a pool they could land on different backends.
    pool = new SQL(url, { max: 1, idleTimeout: 0 });
    client = bunSqlClient(pool);
    dir = await mkdtemp(join(tmpdir(), "sunreye-optimizer-archive-"));
    archivePath = join(dir, "plant.tar.gz");

    const { optimizerDeviceSpec } = await import("../src/automation/optimizer-device");
    await raw.execute(
      sql`insert into plants (name, slug, time_zone) values ('opt', ${PLANT}, 'UTC')`,
    );
    await raw.execute(sql`
      insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
      select id, null, 1, ${INVERTER}, 'Inverter', 'opt-arch-profile', 'inverter'
      from plants where slug = ${PLANT}`);
    // THE OPTIMIZER'S OWN ROW, from the production spec: `connection_id NULL`,
    // `unit_id 0`, `role 'optimizer'`. Nothing about it is a machine.
    const spec = optimizerDeviceSpec(0);
    await raw.execute(sql`
      insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
      select id, ${spec.connectionId}, ${spec.unitId}, ${spec.slug}, ${spec.name},
             ${spec.profileId}, ${spec.role}
      from plants where slug = ${PLANT}`);
    // The restore target: a second row the import can be pointed at, so the
    // source series stays untouched and the two can be compared side by side.
    await raw.execute(sql`
      insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
      select id, null, 0, ${RESTORED}, 'Restored optimizer', ${spec.profileId}, ${spec.role}
      from plants where slug = ${PLANT}`);

    await ensureMetricKeys(metricKeyWriter(client), [
      { key: DECISION, isCounter: false },
      { key: REGIME, isCounter: false },
      { key: ENABLED, isCounter: false },
      { key: MODE, isCounter: false },
      { key: RESTORE, isCounter: false },
    ]);

    // Three decisions and one regime transition, as INTERVALS — the shape the
    // write seam produces for every device.
    const rowsOf = (key: string, values: [string, number][]) =>
      values.map(
        ([time, value]) => sql`(${time}::timestamptz, ${value}, 30000,
          (select min(id) from devices where slug = ${OPTIMIZER}),
          (select min(id) from metric_keys where key = ${key}))`,
      );
    const values = [
      ...rowsOf(DECISION, [
        ["2026-06-01T10:00:00Z", 40],
        ["2026-06-01T10:00:30Z", 25],
        ["2026-06-01T10:01:00Z", 10],
      ]),
      ...rowsOf(REGIME, [["2026-06-01T10:00:00Z", 2]]),
    ];
    await raw.execute(sql`
      insert into metrics_raw (time, value, dur_ms, device_id, metric_id) values
      ${sql.join(values, sql`, `)}`);

    // The CONFIG half, in its own table: the operator switched the optimizer on,
    // moved it to `grid-friendly` (ordinal 1) and left a held register owed back.
    // These are CHANGES, so there is one row per change and no `dur_ms` at all —
    // a different shape from the readings above, travelling in a different
    // archive member, and nothing in the readings' round trip speaks for it.
    const configRows = (
      [
        [ENABLED, "2026-06-01T09:59:00Z", 1],
        [MODE, "2026-06-01T09:59:00Z", 1],
        [RESTORE, "2026-06-01T10:00:30Z", 1],
      ] as const
    ).map(
      ([key, time, value]) => sql`(${time}::timestamptz, ${value},
        (select min(id) from devices where slug = ${OPTIMIZER}),
        (select min(id) from metric_keys where key = ${key}))`,
    );
    await raw.execute(sql`
      insert into metrics_config_log (time, value, device_id, metric_id) values
      ${sql.join(configRows, sql`, `)}`);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await rm(dir, { recursive: true, force: true });
  });

  test("the export names the optimizer and every decision key it wrote", async () => {
    const workDir = await mkdtemp(join(dir, "export-"));
    const result = await exportArchive(client, {
      source: "native",
      out: archivePath,
      workDir,
      tiers: ["raw"],
      appVersion: "2.0.0-dbtest",
    });
    // Four rows and no more: an endpoint-less device is walked exactly like an
    // inverter, and the inverter that has nothing contributes nothing.
    expect(result.manifest.streams.raw).toBe(4);
    expect(result.manifest.devices).toContain(OPTIMIZER);
    expect(result.manifest.metrics).toEqual(expect.arrayContaining([DECISION, REGIME]));
    // The change-log half, counted separately because a config change is not a
    // reading — and exported whatever `tiers` says, since it is not a tier.
    expect(result.manifest.streams.configLog).toBe(3);
    expect(result.manifest.metrics).toEqual(expect.arrayContaining([ENABLED, MODE, RESTORE]));
  }, 120_000);

  test("IMPORT: every decision comes back, with its interval intact", async () => {
    const workDir = await mkdtemp(join(dir, "import-"));
    const result = await importArchive(client, {
      file: archivePath,
      workDir,
      deviceMap: { [OPTIMIZER]: RESTORED },
      applyConfig: false,
    });
    expect(result.skipped).toBeNull();
    expect(result.inserted.raw).toBe(4);
    // The change-log travels on its own member and is inserted directly, so its
    // count is its own — and it is not zero, which is what this import used to
    // be unable to reach at all: the config-log metrics were absent from the
    // manifest, so nothing resolved their ids and the insert failed NOT NULL.
    expect(result.inserted.configLog).toBe(3);

    const { rows } = await raw.execute<{ key: string; value: number; dur_ms: number }>(sql`
      select k.key, r.value, r.dur_ms from metrics_raw r
        join metric_keys k on k.id = r.metric_id
        join devices d on d.id = r.device_id
       where d.slug = ${RESTORED}
       order by k.key, r.time`);
    expect(rows.map((r) => [r.key, r.value, Number(r.dur_ms)])).toEqual([
      [REGIME, 2, 30_000],
      [DECISION, 40, 30_000],
      [DECISION, 25, 30_000],
      [DECISION, 10, 30_000],
    ]);
  }, 300_000);

  test("IMPORT: the operator's settings come back too, as a change-log", async () => {
    // The other half of "the optimizer and its series round-trip". `enabled`,
    // `mode` and `restore.pending` never touch `metrics_raw` — they are the one
    // part of the optimizer's record that lives in `metrics_config_log`, so a
    // round trip proved only over the readings proves nothing about them, and a
    // restored plant would have decisions with no idea what mode made them.
    const { rows } = await raw.execute<{ key: string; value: number; time: Date }>(sql`
      select k.key, c.value, c.time from metrics_config_log c
        join metric_keys k on k.id = c.metric_id
        join devices d on d.id = c.device_id
       where d.slug = ${RESTORED}
       order by c.time, k.key`);
    expect(rows.map((r) => [r.key, r.value, new Date(r.time).toISOString()])).toEqual([
      [ENABLED, 1, "2026-06-01T09:59:00.000Z"],
      [MODE, 1, "2026-06-01T09:59:00.000Z"],
      [RESTORE, 1, "2026-06-01T10:00:30.000Z"],
    ]);
  });

  test("a decision is not a counter on the far side either", async () => {
    // `is_counter` travels with the KEY, and an importer that guessed would make
    // `delta(counter_agg)` invent energy out of a charge-current ceiling.
    const { rows } = await raw.execute<{ key: string; is_counter: boolean }>(
      sql`select key, is_counter from metric_keys where key like 'optimizer.%' order by key`,
    );
    // Every optimizer key the round trip carried, readings and configuration
    // alike — a `1` in the change-log is a boolean, and one guessed as a counter
    // would have `delta(counter_agg)` read a switch being flicked as energy.
    expect(rows).toEqual([
      { key: ENABLED, is_counter: false },
      { key: MODE, is_counter: false },
      { key: REGIME, is_counter: false },
      { key: RESTORE, is_counter: false },
      { key: DECISION, is_counter: false },
    ]);
  });

  test("the restored optimizer is still an optimizer, not an inverter", async () => {
    // A restore that widened the role would put a device with no registers into
    // every plant sum, and orphan every decision keyed to it.
    const repo = await import("@SunReye/db/plant-repo");
    const { rows } = await raw.execute<{ id: number }>(
      sql`select id from plants where slug = ${PLANT}`,
    );
    const devices = await repo.readDevices(raw, Number(rows[0]?.id), { includeRetired: false });
    expect(
      devices
        .filter((d) => d.role === "optimizer")
        .map((d) => d.slug)
        .sort(),
    ).toEqual([OPTIMIZER, RESTORED].sort());
    expect(repo.physicalDevices(devices).map((d) => d.slug)).toEqual([INVERTER]);
  });
});
