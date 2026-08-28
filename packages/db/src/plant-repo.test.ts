import { describe, expect, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  activeDevices,
  createPlant,
  deleteDeviceBattery,
  ensureConnection,
  ensureDevice,
  ensurePlant,
  readConnection,
  readConnections,
  readDevices,
  readPlant,
  readPlantBatteries,
  isRetired,
  readRawSetting,
  updateDevice,
  updatePlant,
  upsertDeviceBattery,
} from "./plant-repo";

/**
 * What these tests are for, and what they are NOT for.
 *
 * They are for the TRANSLATION either side of the statement: the row shapes that
 * come back, the numeric coercions (`count(*)` and a bigint arrive as STRINGS
 * through this driver, and a Map or a comparison keyed by "3" instead of 3 fails
 * silently at the call site), the JSONB normalisation, and the two cases where
 * the right SQL is NO SQL at all — an empty patch, because
 * `update plants set where id = 1` is a syntax error.
 *
 * They are NOT proof that the statements run. A SQL-text assertion cannot be
 * that (`AGENTS.md`; two 500s shipped behind a fully green suite that way), so
 * every statement here is also executed against a real Postgres in
 * `apps/server/db-tests/plant-spine.test.ts`. This layer exists because the
 * mapping code around the statements is ordinary logic and deserves ordinary
 * unit tests — and because `bun run test` must stay database-free.
 */
/**
 * The SQL a builder renders, through the real Postgres dialect.
 *
 * Rendering rather than inspecting the chunk tree: the tree stringifies to
 * `[object Object]`, so a test written against it passes whatever the builder
 * holds — the same trap as `expect(db.execute(...)).rejects`. Going through the
 * dialect also proves the fragments compose into a statement at all.
 */
const dialect = new PgDialect();
const rendered = (query: SQL | undefined): string =>
  query === undefined ? "" : dialect.sqlToQuery(query).sql;

function fakeClient(queue: Array<Array<Record<string, unknown>>> = []) {
  const executed: SQL[] = [];
  const client = {
    async execute(query: SQL) {
      executed.push(query);
      return { rows: queue.shift() ?? [] };
    },
  };
  return { client, executed };
}

/** A plant row as the driver hands it over — ids and measures as strings. */
const plantRow = (over: Record<string, unknown> = {}) => ({
  id: "7",
  name: "My plant",
  slug: "my-plant",
  timeZone: "Europe/Berlin",
  latitude: "50.4",
  longitude: "8.06",
  label: "Limburg",
  arrays: [{ kwp: 9.8, tilt: 30, azimuth: 0 }],
  tempCoefficient: "-0.35",
  systemLoss: "11",
  maxOutputW: "7000",
  houseLoadW: null,
  smartMeterSince: "2026-03-01",
  biddingZone: "DE-LU",
  tariffKey: null,
  ...over,
});

describe("readPlant", () => {
  test("coerces every id and measure the driver may hand over as a string", () => {
    // The whole reason `int()`/`maybeNum()` exist: an int2 arrives as a number
    // today, and a comparison against "7" would fail silently rather than here.
    const { client } = fakeClient([[plantRow()]]);
    return readPlant(client).then((plant) => {
      expect(plant?.id).toBe(7);
      expect(plant?.latitude).toBe(50.4);
      expect(plant?.systemLoss).toBe(11);
      expect(plant?.maxOutputW).toBe(7000);
      expect(plant?.houseLoadW).toBeNull();
      expect(plant?.biddingZone).toBe("DE-LU");
      expect(plant?.tariffKey).toBeNull();
    });
  });

  test("no plant at all is null, not an empty plant", async () => {
    const { client } = fakeClient([[]]);
    expect(await readPlant(client)).toBeNull();
  });

  test("a JSONB arrays column holding garbage reads as no arrays", async () => {
    // A row written by hand — a restore, an import — can hold anything, and the
    // forecast indexes into these entries.
    const { client } = fakeClient([[plantRow({ arrays: "not a list" })]]);
    expect((await readPlant(client))?.arrays).toEqual([]);
    const bad = fakeClient([[plantRow({ arrays: [{ kwp: 9.8, tilt: 400, azimuth: 0 }] })]]);
    expect((await readPlant(bad.client))?.arrays).toEqual([]);
  });

  test("asked for a specific id it selects that one rather than the lowest", async () => {
    const { client, executed } = fakeClient([[plantRow()]]);
    await readPlant(client, 7);
    expect(rendered(executed[0])).toContain("where id =");
  });
});

describe("ensurePlant", () => {
  test("adopts the install's plant WITHOUT executing an insert", async () => {
    // The idempotency contract: `devices.id` is written into five years of
    // readings, and a second insert would take a new int2 and strand all of them.
    const { client, executed } = fakeClient([[plantRow()]]);
    const plant = await ensurePlant(client, { name: "Other", slug: "other" });
    expect(plant.id).toBe(7);
    expect(executed.length).toBe(1);
  });

  test("creates one when there is none, seeding the facts it was given", async () => {
    const { client, executed } = fakeClient([
      [], // readPlant: nothing yet
      [], // the insert
      [plantRow({ systemLoss: "11" })], // the re-select
    ]);
    const plant = await ensurePlant(client, {
      name: "Seeded",
      slug: "seeded",
      facts: { systemLoss: 11 },
    });
    expect(plant.systemLoss).toBe(11);
    expect(executed.length).toBe(3);
  });
});

describe("createPlant", () => {
  test("a row that vanished between the insert and the select is an error, not a null plant", async () => {
    // Every caller goes on to write a device against this id. Returning null
    // here would turn a failed provisioning into a foreign-key violation two
    // statements later, with nothing naming the cause.
    const { client } = fakeClient([[], []]);
    await expect(createPlant(client, { name: "x", slug: "x" })).rejects.toThrow(
      "plant x could not be created",
    );
  });
});

describe("updatePlant", () => {
  test("an empty patch executes NOTHING — the statement would be a syntax error", async () => {
    const { client, executed } = fakeClient();
    await updatePlant(client, 7, {});
    expect(executed).toEqual([]);
  });

  test("names only the columns the patch carries", async () => {
    const { client, executed } = fakeClient();
    await updatePlant(client, 7, { latitude: 50.4, systemLoss: 11 });
    const text = rendered(executed[0]);
    expect(text).toContain("latitude");
    expect(text).toContain("system_loss");
    expect(text).not.toContain("longitude");
  });

  test("null is written, because clearing a nullable column has to be possible", async () => {
    const { client, executed } = fakeClient();
    await updatePlant(client, 7, { maxOutputW: null });
    expect(rendered(executed[0])).toContain("max_output_w");
  });

  test("the arrays column is cast to jsonb rather than passed as a bare parameter", async () => {
    const { client, executed } = fakeClient();
    await updatePlant(client, 7, { arrays: [{ kwp: 5, tilt: 20, azimuth: 0 }] });
    expect(rendered(executed[0])).toContain("::jsonb");
  });

  test("the three references are writable and a slug is not expressible", async () => {
    const { client, executed } = fakeClient();
    await updatePlant(client, 7, {
      name: "Renamed",
      timeZone: "UTC",
      biddingZone: "AT",
      tariffKey: "tariff-2",
    });
    const text = rendered(executed[0]);
    for (const column of ["name", "time_zone", "bidding_zone", "tariff_key"]) {
      expect(text).toContain(column);
    }
    expect(text).not.toContain("slug");
  });
});

describe("connections", () => {
  const connectionRow = {
    id: "3",
    name: "Inverter",
    host: "10.0.0.5",
    port: "502",
    transport: "tcp",
    timeoutMs: "2000",
    pollIntervalMs: "1000",
  };

  test("readConnection coerces the endpoint's numbers and reports absence as null", async () => {
    const present = fakeClient([[connectionRow]]);
    const read = await readConnection(present.client, 7);
    expect(read?.id).toBe(3);
    expect(read?.port).toBe(502);
    expect(read?.pollIntervalMs).toBe(1000);
    const absent = fakeClient([[]]);
    expect(await readConnection(absent.client, 7)).toBeNull();
  });

  test("readConnections lists every endpoint of the plant, coerced", async () => {
    // The poll loop resolves a device's endpoint by `connection_id`, so it needs
    // the whole set rather than the first row: one gateway with three unit ids is
    // one connection, two gateways are two, and a device bound to the second one
    // must not be polled at the first one's address.
    const { client, executed } = fakeClient([
      [connectionRow, { ...connectionRow, id: "4", host: "10.0.0.6" }],
    ]);
    const read = await readConnections(client, 7);
    expect(read.map((c) => c.id)).toEqual([3, 4]);
    expect(read[1]?.host).toBe("10.0.0.6");
    expect(read[0]?.timeoutMs).toBe(2000);
    // No LIMIT: the single-endpoint reader is the one that takes the first row.
    expect(rendered(executed[0])).not.toContain("limit");
  });

  test("readConnections reports a plant with no endpoint as an empty list", async () => {
    expect(await readConnections(fakeClient([[]]).client, 7)).toEqual([]);
  });

  test("an existing endpoint is UPDATED and keeps its id", async () => {
    // Moving a gateway must touch ONE row: the device's `connection_id` binds
    // the two, so a second row would leave it pointing at the old address.
    const { client, executed } = fakeClient([[connectionRow]]);
    const result = await ensureConnection(client, 7, {
      name: "Inverter",
      host: "10.0.0.9",
      port: 8899,
      transport: "rtu-over-tcp",
      timeoutMs: 3000,
      pollIntervalMs: 2000,
    });
    expect(result.id).toBe(3);
    expect(result.host).toBe("10.0.0.9");
    expect(rendered(executed[1])).toContain("update");
  });

  test("with no endpoint yet one is inserted and returned", async () => {
    const { client } = fakeClient([[], [connectionRow]]);
    const result = await ensureConnection(client, 7, {
      name: "Inverter",
      host: "10.0.0.5",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
    expect(result.id).toBe(3);
  });

  test("an insert that returned nothing is an error rather than a phantom endpoint", async () => {
    const { client } = fakeClient([[], []]);
    await expect(
      ensureConnection(client, 7, {
        name: "x",
        host: "h",
        port: 1,
        transport: "tcp",
        timeoutMs: 1,
        pollIntervalMs: 1000,
      }),
    ).rejects.toThrow("connection for plant 7 could not be created");
  });
});

describe("devices", () => {
  const deviceRow = (over: Record<string, unknown> = {}) => ({
    id: "4",
    slug: "inverter",
    name: "Inverter",
    profileId: "deye",
    role: "inverter",
    unitId: "1",
    connectionId: "3",
    ...over,
  });

  test("readDevices maps every row and keeps an absent endpoint null", async () => {
    const { client } = fakeClient([[deviceRow(), deviceRow({ id: "5", connectionId: null })]]);
    const devices = await readDevices(client, 7);
    expect(devices.map((d) => d.id)).toEqual([4, 5]);
    expect(devices[0]?.connectionId).toBe(3);
    expect(devices[1]?.connectionId).toBeNull();
  });

  test("an in-service device reads back with retiredAt null, not undefined", async () => {
    // The column is the lifecycle flag, and a missing property would make every
    // `retiredAt === null` check in a caller pass by accident.
    const { client } = fakeClient([[deviceRow()]]);
    const devices = await readDevices(client, 7);
    expect(devices[0]?.retiredAt).toBeNull();
  });

  test("a retired device's timestamp survives the mapping as a Date", async () => {
    const at = new Date("2026-08-01T10:00:00Z");
    const { client } = fakeClient([[deviceRow({ retiredAt: at })]]);
    const devices = await readDevices(client, 7);
    expect(devices[0]?.retiredAt?.toISOString()).toBe("2026-08-01T10:00:00.000Z");
  });

  test("a timestamp the driver hands back as a STRING is still a Date", async () => {
    // Every other coercion in this module exists for the same reason: the driver
    // decides the JS type, and a string here would silently fail a date
    // comparison at the call site rather than here.
    const { client } = fakeClient([[deviceRow({ retiredAt: "2026-08-01T10:00:00Z" })]]);
    const devices = await readDevices(client, 7);
    expect(devices[0]?.retiredAt?.toISOString()).toBe("2026-08-01T10:00:00.000Z");
  });

  test("readDevices lists retired devices by DEFAULT — their history is the point", async () => {
    const { client, executed } = fakeClient([[deviceRow({ retiredAt: new Date() })]]);
    const devices = await readDevices(client, 7);
    expect(devices).toHaveLength(1);
    expect(rendered(executed[0])).not.toContain("retired_at is null");
  });

  test("includeRetired: false narrows the statement instead of filtering in JS", async () => {
    // Filtering after the fact would still ship every retired device's row to
    // the caller, and the poll loop's list is the one that must not contain one.
    const { client, executed } = fakeClient([[deviceRow()]]);
    await readDevices(client, 7, { includeRetired: false });
    expect(rendered(executed[0])).toContain("retired_at is null");
  });

  test("retiring is an UPDATE of the flag, never a DELETE", async () => {
    // `ON DELETE RESTRICT` means a device with readings can never be deleted —
    // which is correct — so this column is the only way out of service.
    const at = new Date("2026-08-01T10:00:00Z");
    const { client, executed } = fakeClient([[], [deviceRow({ retiredAt: at })]]);
    const device = await updateDevice(client, 4, { retiredAt: at });
    expect(device.retiredAt?.toISOString()).toBe("2026-08-01T10:00:00.000Z");
    const text = rendered(executed[0]);
    expect(text).toContain("retired_at");
    expect(text).not.toContain("delete");
  });

  test("un-retiring is possible: null is a patched value, not an absent one", async () => {
    // `retiredAt: undefined` means "leave it alone" while `null` means "bring it
    // back into service" — the same distinction `connectionId` already draws.
    const { client, executed } = fakeClient([[], [deviceRow()]]);
    await updateDevice(client, 4, { retiredAt: null });
    expect(rendered(executed[0])).toContain("retired_at");
  });

  test("an untouched retiredAt is not named in the UPDATE", async () => {
    const { client, executed } = fakeClient([[], [deviceRow({ retiredAt: new Date() })]]);
    await updateDevice(client, 4, { name: "Garage" });
    expect(rendered(executed[0])).not.toContain("retired_at");
  });

  test("ensureDevice inserts ON CONFLICT DO NOTHING, then reads the row back", async () => {
    // `DO NOTHING` and not `DO UPDATE`: the conflicting row already has an id in
    // five years of readings, and its name may have been edited by the operator.
    const { client, executed } = fakeClient([[], [deviceRow()]]);
    const device = await ensureDevice(client, {
      plantId: 7,
      connectionId: 3,
      unitId: 1,
      slug: "inverter",
      name: "Inverter",
      profileId: "deye",
      role: "inverter",
    });
    expect(device.id).toBe(4);
    const insert = rendered(executed[0]);
    expect(insert).toContain("on conflict");
    expect(insert).toContain("do nothing");
  });

  test("a device that could not be created is an error, not a zero id", async () => {
    const { client } = fakeClient([[], []]);
    await expect(
      ensureDevice(client, {
        plantId: 7,
        connectionId: null,
        unitId: 1,
        slug: "gone",
        name: "x",
        profileId: "p",
        role: "inverter",
      }),
    ).rejects.toThrow("device gone could not be created");
  });

  test("updateDevice with an empty patch still reads the row and never UPDATEs", async () => {
    const { client, executed } = fakeClient([[deviceRow()]]);
    const device = await updateDevice(client, 4, {});
    expect(device.id).toBe(4);
    expect(executed.length).toBe(1);
    expect(rendered(executed[0])).toContain("select");
  });

  test("updateDevice names each patched field and never a slug", async () => {
    const { client, executed } = fakeClient([[], [deviceRow({ profileId: "sigenergy" })]]);
    const device = await updateDevice(client, 4, {
      name: "Garage",
      profileId: "sigenergy",
      role: "inverter",
      unitId: 3,
      connectionId: null,
    });
    expect(device.profileId).toBe("sigenergy");
    const text = rendered(executed[0]);
    for (const column of ["name", "profile_id", "role", "unit_id", "connection_id"]) {
      expect(text).toContain(column);
    }
    expect(text).not.toContain("slug =");
  });

  test("updating a device that does not exist says so", async () => {
    const { client } = fakeClient([[], []]);
    await expect(updateDevice(client, 99, { name: "x" })).rejects.toThrow(
      "device 99 does not exist",
    );
  });
});

describe("batteries", () => {
  test("readPlantBatteries coerces the pack measures and keeps null distinct from 0", async () => {
    // `nominalV` null means "never stated"; 0 would be a voltage, and every
    // commanded charge current is scaled by this number.
    const { client } = fakeClient([
      [
        { deviceId: "4", usableKwh: "30", maxChargeW: "9000", minSoc: "5", nominalV: "48" },
        { deviceId: "5", usableKwh: "5", maxChargeW: null, minSoc: "0", nominalV: null },
      ],
    ]);
    const packs = await readPlantBatteries(client, 7);
    expect(packs[0]).toEqual({
      deviceId: 4,
      usableKwh: 30,
      maxChargeW: 9000,
      minSoc: 5,
      nominalV: 48,
    });
    expect(packs[1]?.maxChargeW).toBeNull();
    expect(packs[1]?.minSoc).toBe(0);
    expect(packs[1]?.nominalV).toBeNull();
  });

  test("upsertDeviceBattery is an upsert on device_id, so it is one row forever", async () => {
    const { client, executed } = fakeClient();
    await upsertDeviceBattery(client, 4, {
      usableKwh: 12,
      maxChargeW: null,
      minSoc: 8,
      nominalV: null,
    });
    const text = rendered(executed[0]);
    expect(text).toContain("on conflict");
    expect(text).toContain("do update");
  });

  test("deleting a pack deletes the PACK, never the device", async () => {
    const { client, executed } = fakeClient();
    await deleteDeviceBattery(client, 4);
    const text = rendered(executed[0]);
    expect(text).toContain("delete from batteries");
    expect(text).not.toContain("devices");
  });
});

describe("readRawSetting", () => {
  test("returns the stored value verbatim — no schema, no default", async () => {
    // The seeding path needs what is REALLY there: `readSetting` safeParses to
    // the default with no log, so a blob the current schema rejects would read
    // as "never configured" and its values would be lost.
    const rejected = { forecast: { arrays: [{ kwp: 9.8, tilt: 400, azimuth: 0 }] } };
    const { client } = fakeClient([[{ value: rejected }]]);
    expect(await readRawSetting(client, "weather")).toEqual(rejected);
  });

  test("an absent row is undefined, and a stored null is null", async () => {
    // Different answers: one means "nothing was ever configured", the other
    // means a row exists holding nothing.
    const absent = fakeClient([[]]);
    expect(await readRawSetting(absent.client, "weather")).toBeUndefined();
    const stored = fakeClient([[{ value: null }]]);
    expect(await readRawSetting(stored.client, "weather")).toBeNull();
  });
});

describe("readRawSetting: a jsonb value wrapped in a JSON string", () => {
  test("a double-encoded 1.x blob is mined, not read as absent", async () => {
    // A `jsonb` column can hold the document AS A JSON STRING, and a 1.2.0-shaped
    // database genuinely does (scripts/fixture-1-2-0.ts writes every app_settings
    // row that way). Reading it as a bare string means `object(value)` sees
    // nothing, and a fully-configured install is seeded as if it had never been
    // configured — losing its coordinates, export cap and battery silently.
    const db = {
      execute: async () => ({ rows: [{ value: '{"label":"Limburg-Weilburg","lat":50.4}' }] }),
    };
    expect(await readRawSetting(db, "weather")).toEqual({ label: "Limburg-Weilburg", lat: 50.4 });
  });

  test("an ordinary object value is untouched", async () => {
    const db = { execute: async () => ({ rows: [{ value: { label: "Hof" } }] }) };
    expect(await readRawSetting(db, "weather")).toEqual({ label: "Hof" });
  });

  test("an absent row is still undefined, not null", async () => {
    // `undefined` means "the row is genuinely absent" and the seeding path
    // depends on telling that apart from a stored null.
    const db = { execute: async () => ({ rows: [] }) };
    expect(await readRawSetting(db, "weather")).toBeUndefined();
  });

  test("a plain string setting comes back as itself", async () => {
    const db = { execute: async () => ({ rows: [{ value: "Europe/Berlin" }] }) };
    expect(await readRawSetting(db, "tz")).toBe("Europe/Berlin");
  });
});

/**
 * The retirement predicate and filter.
 *
 * Pure, and separate from the read, because the server holds lists of devices it
 * did not fetch itself — a cached runtime roster, a set of adoption candidates —
 * and those must apply the same rule as the SQL arm. Two spellings of "is this
 * device in service" is exactly how a retired device gets polled again.
 */
describe("device retirement", () => {
  const device = (retiredAt: Date | null) => ({
    id: 1,
    slug: "inverter",
    name: "Inverter",
    profileId: "deye",
    role: "inverter",
    unitId: 1,
    connectionId: null,
    retiredAt,
  });

  test("a device with no retirement date is in service", () => {
    expect(isRetired(device(null))).toBe(false);
  });

  test("a device with a retirement date is retired", () => {
    expect(isRetired(device(new Date("2026-08-01T00:00:00Z")))).toBe(true);
  });

  test("the epoch is a retirement date, not a falsy nothing", () => {
    // `new Date(0)` is truthy, but the same flag held as a NUMBER would not be —
    // the trap this pins, since the column is read through a driver that decides
    // the JS type.
    expect(isRetired(device(new Date(0)))).toBe(true);
  });

  test("a FUTURE retirement date still counts as retired", () => {
    // The flag is a lifecycle state, not a schedule: nothing compares it to the
    // clock, so a date typed ahead of time must not leave the device polled
    // until then.
    expect(isRetired(device(new Date("2099-01-01T00:00:00Z")))).toBe(true);
  });

  test("activeDevices keeps the in-service ones, in order", () => {
    const rows = [
      { ...device(null), id: 1 },
      { ...device(new Date("2026-01-01T00:00:00Z")), id: 2 },
      { ...device(null), id: 3 },
    ];
    expect(activeDevices(rows).map((d) => d.id)).toEqual([1, 3]);
  });

  test("activeDevices on an all-retired plant is empty, not the input", () => {
    expect(activeDevices([device(new Date("2026-01-01T00:00:00Z"))])).toEqual([]);
  });

  test("activeDevices on no devices is no devices", () => {
    expect(activeDevices([])).toEqual([]);
  });

  test("activeDevices leaves its input alone", () => {
    const rows = [device(null), device(new Date())];
    activeDevices(rows);
    expect(rows).toHaveLength(2);
  });
});
