/**
 * THE WRITE SEAM, end to end, against a real TimescaleDB.
 *
 * The unit suite (`../src/inverter/device-writer.test.ts`) proves the routing
 * and the identity translation against doubles. What it cannot prove is the
 * claim this deliverable actually makes: that a sample committed for a SECOND
 * registered device — one with no Modbus endpoint, no poll loop, and a metric
 * declaration of its own — is accepted by Postgres and lands in `metrics_raw`
 * under that device's `device_id`.
 *
 * That is a statement about the engine, not about the SQL text:
 * `metrics_raw.device_id` is a NOT NULL foreign key `ON DELETE RESTRICT` into a
 * table whose ids are `GENERATED ALWAYS AS IDENTITY`, so nothing short of a real
 * insert says whether the id the writer resolved is the id the row can carry.
 */
import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import type { InverterProfile } from "@SunReye/inverter-core";
import { databaseReachable, resetTestDatabase } from "./harness";

const reachable = await databaseReachable();
if (!reachable) {
  const message = "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}
const suite = reachable ? describe : describe.skip;

suite("a sample committed for any registered device", () => {
  test("lands in metrics_raw under that device's id, with its own storage classes", async () => {
    const url = await resetTestDatabase();
    const { createDbAt } = await import("@SunReye/db");
    const db = createDbAt(url);

    const { createDeviceRegistry } = await import("../src/devices/registry");
    const { createDeviceWriter } = await import("../src/inverter/device-writer");
    const { createHistoryBuffer } = await import("../src/inverter/history-buffer");
    const { createIdentifiedCommit, createRowIdentifier } =
      await import("../src/inverter/storage-identity");
    const { createIdentityResolver } = await import("../src/shared/identity");
    const { metricsConfigLog, metricsRaw } = await import("@SunReye/db/schema/metrics");
    const repo = await import("@SunReye/db/plant-repo");

    // --- the plant: one polled inverter, and one device with NO endpoint ----
    //
    // Inserted directly, and every name below is prefixed: the harness memoizes
    // ONE database for the whole directory, so `ensurePlant` would adopt
    // whichever plant another spec created and this suite's rows would mix with
    // theirs.
    await db.execute(sql`insert into plants (name, slug) values ('Seam', 'seam-plant')`);
    const { rows: plantRows } = await db.execute(
      sql`select id from plants where slug = 'seam-plant'`,
    );
    const plant = { id: Number((plantRows[0] as { id: number }).id) };
    const connection = await repo.ensureConnection(db, plant.id, {
      name: "bus",
      host: "10.0.0.5",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
    await repo.ensureDevice(db, {
      plantId: plant.id,
      connectionId: connection.id,
      unitId: 1,
      slug: "seam-inverter",
      name: "Inverter 1",
      profileId: "acme-hybrid",
      role: "inverter",
    });
    const second = await repo.ensureDevice(db, {
      plantId: plant.id,
      // No connection and no bus at all — the shape #88's loadpoints and #172's
      // optimizer have, and the one a poll loop can never serve.
      connectionId: null,
      unitId: 0,
      slug: "seam-optimizer",
      name: "Optimizer",
      profileId: "seam-optimizer-profile",
      role: "optimizer",
    });

    // --- the registry, over the real table ---------------------------------
    const registry = createDeviceRegistry({
      readDevices: () => repo.readDevices(db, plant.id, { includeRetired: false }),
      // The optimizer's declarations, as a coded integration would state them:
      // one measurement worth charting, one setting worth logging on change.
      resolveProfile: async (id): Promise<InverterProfile | null> =>
        id === "seam-optimizer-profile"
          ? {
              id,
              name: "Optimizer",
              manufacturer: "SunReye",
              metrics: [
                {
                  key: "seam.decision.target",
                  topic: "seam/decision/target",
                  label: "Target",
                  unit: "A",
                  group: "optimizer",
                  access: "r",
                  scale: 1,
                  type: "U_WORD",
                  addresses: [],
                  binding: { via: "compute", expr: { sum: [] } },
                },
                {
                  key: "seam.decision.mode",
                  topic: "decision/mode",
                  label: "Mode",
                  unit: null,
                  group: "optimizer",
                  // Writable ⇒ a setting ⇒ the change-log, not the hypertable.
                  access: "rw",
                  scale: 1,
                  type: "U_WORD",
                  addresses: [],
                  binding: { via: "compute", expr: { sum: [] } },
                },
              ],
            }
          : null,
      logger: { warn: () => {} },
    });
    await registry.reload();

    const optimizer = registry.get("seam-optimizer");
    expect(optimizer?.deviceClass).toBe("optimizer");
    expect(registry.list().map((d) => d.id)).toContain("seam-inverter");
    expect(registry.list().map((d) => d.id)).toContain("seam-optimizer");

    // --- the seam, wired exactly as the runtime wires it --------------------
    const identity = createIdentityResolver({ db });
    const identifier = createRowIdentifier({ resolver: identity, logger: { warn: () => {} } });
    const buffer = (table: typeof metricsRaw | typeof metricsConfigLog) =>
      createHistoryBuffer({
        commit: createIdentifiedCommit({
          identify: identifier.identify,
          insert: (rows) => db.insert(table).values(rows),
        }),
        logger: { error: () => {} },
      });
    const series = buffer(metricsRaw);
    const config = buffer(metricsConfigLog);
    const writer = createDeviceWriter({
      series,
      config,
      registerMetrics: (specs) => void identity.registerMetrics(specs),
    });

    // Two samples, so the first interval CLOSES and is written; no poll loop,
    // no endpoint, no driver — an instance and a set of readings.
    const t0 = new Date("2026-08-30T10:00:00.000Z");
    const t1 = new Date("2026-08-30T10:00:01.000Z");
    if (!optimizer) throw new Error("the optimizer is not registered");
    writer.commit(optimizer, {
      time: t0,
      metrics: { "seam.decision.target": 16, "seam.decision.mode": 2 },
    });
    writer.commit(optimizer, {
      time: t1,
      metrics: { "seam.decision.target": 10, "seam.decision.mode": 2 },
    });
    await series.flush();
    await config.flush();

    const { rows: stored } = await db.execute(sql`
      select r.device_id, k.key, r.value, r.dur_ms
        from metrics_raw r join metric_keys k on k.id = r.metric_id
       where k.key like 'seam.%'
       order by r.time asc`);
    expect(stored).toEqual([
      { device_id: second.id, key: "seam.decision.target", value: 16, dur_ms: 1000 },
    ]);

    // The storage classes are the DEVICE's own: a writable metric is a setting,
    // so it is logged once on change rather than written every sample.
    const { rows: logged } = await db.execute(sql`
      select l.device_id, k.key, l.value
        from metrics_config_log l join metric_keys k on k.id = l.metric_id
       where k.key like 'seam.%'`);
    expect(logged).toEqual([{ device_id: second.id, key: "seam.decision.mode", value: 2 }]);

    // And the counter class travelled with the key, from this device's own
    // declaration — nothing else in the database can answer what a metric means.
    const { rows: keys } = await db.execute(
      sql`select key, unit, is_counter from metric_keys where key like 'seam.%' order by key`,
    );
    expect(keys).toEqual([
      { key: "seam.decision.mode", unit: null, is_counter: false },
      { key: "seam.decision.target", unit: "A", is_counter: false },
    ]);
  });
});
