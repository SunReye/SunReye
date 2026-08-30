/**
 * EVCC LOADPOINTS HAVE HISTORY — end to end, against a real TimescaleDB.
 *
 * The claim this step actually makes. Before it, nothing under
 * `apps/server/src/evcc/` wrote to `metrics_raw`: charge power and session
 * energy were a WebSocket topic and a card, with no history, no rollups and no
 * statistics. Registering loadpoints as devices is what puts them there.
 *
 * It has to be a database spec, not a unit spec. `metrics_raw.device_id` is a
 * NOT NULL foreign key `ON DELETE RESTRICT` into a table whose ids are
 * `GENERATED ALWAYS AS IDENTITY`, the read path resolves a device SLUG back to
 * that int2, and the bucketing goes through a Timescale hyperfunction over a
 * UNION — none of which a SQL-text assertion can speak to. Two 500s shipped
 * behind a fully green unit suite that way.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { sql } from "drizzle-orm";
import { databaseReachable, resetTestDatabase } from "./harness";

const reachable = await databaseReachable();

// The real module namespace is live, so the real exports have to be snapshotted
// BY VALUE before anything is installed over them — see AGENTS.md on
// `mock.module` being process-global and permanent.
const realDb = await import("@SunReye/db");
const realDbExports = { ...realDb };

if (!reachable) {
  const message =
    "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL. Start one with `bun run db:start`.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}

const suite = reachable ? describe : describe.skip;

suite("an EVCC loadpoint's readings reach metrics_raw and come back out", () => {
  let raw: ReturnType<typeof realDbExports.createDbAt>;

  beforeAll(async () => {
    const url = await resetTestDatabase();
    raw = realDbExports.createDbAt(url);
    mock.module("@SunReye/db", () => ({ ...realDbExports, db: raw }));
  });

  afterAll(() => {
    mock.module("@SunReye/db", () => ({ ...realDbExports }));
  });

  test("two loadpoints are two devices, and each one's charge power is its own", async () => {
    const { createDeviceRegistry } = await import("../src/devices/registry");
    const { resolveCoded } = await import("../src/devices/coded");
    const { createDeviceWriter } = await import("../src/inverter/device-writer");
    const { createHistoryBuffer } = await import("../src/inverter/history-buffer");
    const { createIdentifiedCommit, createRowIdentifier } =
      await import("../src/inverter/storage-identity");
    const { createIdentityResolver } = await import("../src/shared/identity");
    const { metricsConfigLog, metricsRaw } = await import("@SunReye/db/schema/metrics");
    const { queryRecentBuckets } = await import("../src/shared/history");
    const { createLoadpointRegistrar } = await import("../src/evcc/evcc-registrar");
    const { loadpointDeviceSpec } = await import("../src/evcc/evcc-devices");
    const repo = await import("@SunReye/db/plant-repo");

    // The harness memoizes ONE database for the whole directory, so this suite
    // owns its own plant and every assertion is scoped to its own metric keys.
    await raw.execute(sql`insert into plants (name, slug) values ('EV', 'evcc-plant')`);
    const { rows: plantRows } = await raw.execute(
      sql`select id from plants where slug = 'evcc-plant'`,
    );
    const plantId = Number((plantRows[0] as { id: number }).id);

    // --- the seam, wired exactly as the runtime wires it --------------------
    const identity = createIdentityResolver({ db: raw });
    const identifier = createRowIdentifier({ resolver: identity, logger: { warn: () => {} } });
    const buffer = (table: typeof metricsRaw | typeof metricsConfigLog) =>
      createHistoryBuffer({
        commit: createIdentifiedCommit({
          identify: identifier.identify,
          insert: (rows) => raw.insert(table).values(rows),
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

    // --- the registry, over the real table, with the CODED tier wired -------
    //
    // `resolveCoded` is the production table: a loadpoint's `profile_id` names a
    // declaration compiled into the server, and the profile store is never asked
    // about it. `resolveProfile` throwing proves that.
    const registry = createDeviceRegistry({
      readDevices: () => repo.readDevices(raw, plantId, { includeRetired: false }),
      resolveProfile: async (id) => {
        throw new Error(`the profile store must never be asked about ${id}`);
      },
      resolveCoded,
      logger: { warn: () => {} },
    });

    const registrar = createLoadpointRegistrar({
      async ensureDevice(_id, index, title) {
        // The production wiring, over the real table: `ensureDevice` is
        // `ON CONFLICT DO NOTHING` + SELECT, so it answers for a RETIRED row
        // too — which the roster read above excludes.
        const row = await repo.ensureDevice(raw, loadpointDeviceSpec(plantId, index, title));
        return repo.isRetired(row) ? "retired" : "ready";
      },
      reloadRegistry: async () => void (await registry.reload()),
      device: (id) => registry.get(id),
      commit: writer.commit,
      forgetDevice: writer.forget,
      logger: { warn: () => {} },
    });

    /** A loadpoint snapshot with everything at its "nothing plugged in" value. */
    const loadpoint = (index: number, overrides: Record<string, unknown> = {}) =>
      ({
        index,
        title: `Loadpoint ${index}`,
        mode: "pv",
        chargePower: 0,
        chargePowerLive: 0,
        chargePowerSource: "measured",
        charging: false,
        connected: false,
        vehicleSoc: null,
        vehicleRange: null,
        vehicleTitle: null,
        vehicleName: null,
        sessionEnergy: null,
        chargeRemainingEnergy: null,
        limitSoc: null,
        effectiveLimitSoc: null,
        vehicleLimitSoc: null,
        batteryBoost: false,
        batteryBoostLimit: null,
        vehicleCapacityKwh: null,
        phasesActive: null,
        ...overrides,
      }) as never;

    // A window far from the wall clock, so nothing here depends on when the
    // suite runs and `queryRecentBuckets` can be given an explicit `now`.
    const PAST = new Date("2026-01-01T12:00:00.000Z");
    const at = (secondsAgo: number) => new Date(PAST.getTime() - secondsAgo * 1000);

    // Two loadpoints, drawing different power, with a car on the first only.
    await registrar.sync(
      [
        loadpoint(1, {
          chargePower: 7200,
          chargePowerLive: 7200,
          connected: true,
          charging: true,
          vehicleSoc: 55,
          sessionEnergy: 4500,
        }),
        loadpoint(2, { chargePower: 0, chargePowerLive: 0 }),
      ],
      at(20),
    );
    // A second instant, so the first interval CLOSES — a series row is written
    // when its interval ends, not when it opens.
    await registrar.sync(
      [
        loadpoint(1, {
          chargePower: 3600,
          chargePowerLive: 3600,
          connected: true,
          charging: true,
          vehicleSoc: 57,
          sessionEnergy: 8100,
        }),
        loadpoint(2, { chargePower: 0, chargePowerLive: 0 }),
      ],
      at(10),
    );
    await series.flush();
    await config.flush();

    // --- it is in the hypertable, under the right device --------------------
    const { rows: stored } = await raw.execute(sql`
      select d.slug, k.key, r.value, r.dur_ms
        from metrics_raw r
        join metric_keys k on k.id = r.metric_id
        join devices d on d.id = r.device_id
       where k.key like 'ev.%'
       order by d.slug asc, k.key asc`);

    // Only what CHANGED. A series row is written when its interval closes, so
    // `connected`/`charging` — true across both instants — are still held open,
    // and loadpoint 2, which drew nothing throughout, has written nothing yet.
    // That is the storage policy doing its job for a coded device exactly as it
    // does for a Modbus one.
    expect(stored).toEqual([
      { slug: "evcc-loadpoint-1", key: "ev.charge.power", value: 7200, dur_ms: 10_000 },
      { slug: "evcc-loadpoint-1", key: "ev.session.energy", value: 4.5, dur_ms: 10_000 },
      { slug: "evcc-loadpoint-1", key: "ev.vehicle.soc", value: 55, dur_ms: 10_000 },
    ]);

    // Shutdown closes every open interval — otherwise the currently-held value
    // of every metric of every device is lost.
    writer.close(at(5));
    await series.flush();

    const { rows: closed } = await raw.execute(sql`
      select d.slug, k.key from metrics_raw r
        join metric_keys k on k.id = r.metric_id
        join devices d on d.id = r.device_id
       where k.key in ('ev.connected', 'ev.charging')
       order by d.slug asc, k.key asc`);
    expect(closed).toEqual([
      { slug: "evcc-loadpoint-1", key: "ev.charging" },
      { slug: "evcc-loadpoint-1", key: "ev.connected" },
      { slug: "evcc-loadpoint-2", key: "ev.charging" },
      { slug: "evcc-loadpoint-2", key: "ev.connected" },
    ]);

    // The session counter's class travelled with the key: a continuous aggregate
    // cannot ask a device what a metric means.
    const { rows: keys } = await raw.execute(
      sql`select key, unit, is_counter from metric_keys where key like 'ev.%' order by key`,
    );
    expect(keys).toEqual([
      { key: "ev.charge.power", unit: "W", is_counter: false },
      { key: "ev.charging", unit: null, is_counter: false },
      { key: "ev.connected", unit: null, is_counter: false },
      { key: "ev.session.energy", unit: "kWh", is_counter: true },
      { key: "ev.vehicle.soc", unit: "%", is_counter: false },
    ]);

    // --- and it comes back out of a history query ---------------------------
    //
    // The read path resolves the device SLUG to the int2 the rows were written
    // under and buckets through a Timescale hyperfunction. This is the thing the
    // dashboard actually calls.
    const history = await queryRecentBuckets({
      inverterId: "evcc-loadpoint-1",
      seconds: 300,
      stepSeconds: 1,
      now: PAST,
    });
    expect(history.metrics["ev.charge.power"]?.v).toEqual([7200, 3600]);
    expect(history.metrics["ev.vehicle.soc"]?.v).toEqual([55, 57]);

    // The second loadpoint's history is its OWN, and it is not the first's.
    const second = await queryRecentBuckets({
      inverterId: "evcc-loadpoint-2",
      seconds: 300,
      stepSeconds: 1,
      now: PAST,
    });
    expect(second.metrics["ev.charge.power"]?.v).toEqual([0]);
    expect(second.metrics["ev.vehicle.soc"]).toBeUndefined();
  });

  test("a retired loadpoint is ensured once and never reloaded for", async () => {
    // THE ENSURE+RELOAD LOOP, over the real table — and it has to be here,
    // because both halves of it are statements about Postgres: `ensureDevice` is
    // `insert … on conflict do nothing` followed by a SELECT with no
    // `retired_at` predicate, so it answers "the row is there" for a row the
    // operator retired, while `readDevices(..., { includeRetired: false })`
    // excludes exactly that row. A unit double can assert what the registrar
    // does with those two answers; only this can show that Postgres really gives
    // them.
    const { createDeviceRegistry } = await import("../src/devices/registry");
    const { resolveCoded } = await import("../src/devices/coded");
    const { createLoadpointRegistrar } = await import("../src/evcc/evcc-registrar");
    const { loadpointDeviceSpec } = await import("../src/evcc/evcc-devices");
    const repo = await import("@SunReye/db/plant-repo");

    await raw.execute(sql`insert into plants (name, slug) values ('R', 'evcc-retired-plant')`);
    const { rows: plantRows } = await raw.execute(
      sql`select id from plants where slug = 'evcc-retired-plant'`,
    );
    const plantId = Number((plantRows[0] as { id: number }).id);
    const created = await repo.ensureDevice(raw, loadpointDeviceSpec(plantId, 1, "Garage"));
    // The operator retires it in Settings → Devices.
    await repo.updateDevice(raw, created.id, { retiredAt: new Date() });

    let reloads = 0;
    const registry = createDeviceRegistry({
      readDevices: () => repo.readDevices(raw, plantId, { includeRetired: false }),
      resolveProfile: async () => null,
      resolveCoded,
      logger: { warn: () => {} },
    });
    const ensures: string[] = [];
    const warnings: string[] = [];
    const registrar = createLoadpointRegistrar({
      async ensureDevice(id, index, title) {
        ensures.push(id);
        const row = await repo.ensureDevice(raw, loadpointDeviceSpec(plantId, index, title));
        return repo.isRetired(row) ? "retired" : "ready";
      },
      reloadRegistry: async () => {
        reloads += 1;
        await registry.reload();
      },
      device: (id) => registry.get(id),
      commit: () => {
        throw new Error("a retired device must never be committed to");
      },
      forgetDevice: () => {},
      logger: { warn: (template) => void warnings.push(template) },
    });

    const loadpoint = (index: number) =>
      ({
        index,
        title: "Garage",
        mode: "pv",
        chargePower: 0,
        chargePowerLive: 0,
        chargePowerSource: "measured",
        charging: false,
        connected: false,
        vehicleSoc: null,
        vehicleRange: null,
        vehicleTitle: null,
        vehicleName: null,
        sessionEnergy: null,
        chargeRemainingEnergy: null,
        limitSoc: null,
        effectiveLimitSoc: null,
        vehicleLimitSoc: null,
        batteryBoost: false,
        batteryBoostLimit: null,
        vehicleCapacityKwh: null,
        phasesActive: null,
      }) as never;

    const T = new Date("2026-01-03T12:00:00.000Z");
    for (let i = 0; i < 5; i++)
      await registrar.sync([loadpoint(1)], new Date(T.getTime() + i * 200));

    // The row exists — so a boolean answer would have been `true` five times
    // over, and each one would have re-read the whole device table.
    expect(
      repo.isRetired(await repo.ensureDevice(raw, loadpointDeviceSpec(plantId, 1, "Garage"))),
    ).toBe(true);
    expect(ensures).toEqual(["evcc-loadpoint-1"]);
    expect(reloads).toBe(0);
    expect(warnings).toHaveLength(1);
  });

  test("a fed-forward figure is painted but is never stored", async () => {
    // Provenance, proved against the real table. The estimator predicts the
    // effect of a command one EVCC loop before EVCC confirms it; that is the
    // right thing to render and the wrong thing to keep for five years.
    const { createDeviceRegistry } = await import("../src/devices/registry");
    const { resolveCoded } = await import("../src/devices/coded");
    const { createDeviceWriter } = await import("../src/inverter/device-writer");
    const { createHistoryBuffer } = await import("../src/inverter/history-buffer");
    const { createIdentifiedCommit, createRowIdentifier } =
      await import("../src/inverter/storage-identity");
    const { createIdentityResolver } = await import("../src/shared/identity");
    const { metricsConfigLog, metricsRaw } = await import("@SunReye/db/schema/metrics");
    const { loadpointSample } = await import("../src/evcc/evcc-devices");
    const repo = await import("@SunReye/db/plant-repo");

    await raw.execute(sql`insert into plants (name, slug) values ('FF', 'evcc-ff-plant')`);
    const { rows: plantRows } = await raw.execute(
      sql`select id from plants where slug = 'evcc-ff-plant'`,
    );
    const plantId = Number((plantRows[0] as { id: number }).id);
    await repo.ensureDevice(raw, {
      plantId,
      connectionId: null,
      unitId: 0,
      slug: "evcc-ff-loadpoint",
      name: "Predicted",
      profileId: "evcc-loadpoint",
      role: "charger",
    });

    const registry = createDeviceRegistry({
      readDevices: () => repo.readDevices(raw, plantId, { includeRetired: false }),
      resolveProfile: async () => null,
      resolveCoded,
      logger: { warn: () => {} },
    });
    await registry.reload();
    const device = registry.get("evcc-ff-loadpoint");
    if (!device) throw new Error("the loadpoint is not registered");

    const identity = createIdentityResolver({ db: raw });
    const identifier = createRowIdentifier({ resolver: identity, logger: { warn: () => {} } });
    const buffer = (table: typeof metricsRaw | typeof metricsConfigLog) =>
      createHistoryBuffer({
        commit: createIdentifiedCommit({
          identify: identifier.identify,
          insert: (rows) => raw.insert(table).values(rows),
        }),
        logger: { error: () => {} },
      });
    const series = buffer(metricsRaw);
    const writer = createDeviceWriter({
      series,
      config: buffer(metricsConfigLog),
      registerMetrics: (specs) => void identity.registerMetrics(specs),
    });

    const predicted = (watts: number, connected: boolean) =>
      ({
        index: 1,
        title: null,
        mode: "pv",
        chargePower: 0,
        chargePowerLive: watts,
        chargePowerSource: "feedforward",
        charging: connected,
        connected,
        vehicleSoc: null,
        vehicleRange: null,
        vehicleTitle: null,
        vehicleName: null,
        sessionEnergy: null,
        chargeRemainingEnergy: null,
        limitSoc: null,
        effectiveLimitSoc: null,
        vehicleLimitSoc: null,
        batteryBoost: false,
        batteryBoostLimit: null,
        vehicleCapacityKwh: null,
        phasesActive: null,
      }) as never;

    const T = new Date("2026-01-02T12:00:00.000Z");
    writer.commit(device, loadpointSample(predicted(11_000, true), T));
    writer.commit(device, loadpointSample(predicted(11_000, true), new Date(T.getTime() + 5000)));
    writer.close(new Date(T.getTime() + 10_000));
    await series.flush();

    const { rows: stored } = await raw.execute(sql`
      select k.key from metrics_raw r
        join metric_keys k on k.id = r.metric_id
        join devices d on d.id = r.device_id
       where d.slug = 'evcc-ff-loadpoint'
       order by k.key`);
    // The states are readings and are stored; the predicted power is not.
    expect(stored).toEqual([{ key: "ev.charging" }, { key: "ev.connected" }]);
  });
});
