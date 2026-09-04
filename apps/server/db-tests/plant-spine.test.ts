/**
 * The dimension spine — plants, connections, devices, batteries — against a real
 * TimescaleDB.
 *
 * This layer exists because every claim below is a claim about what POSTGRES
 * does, and none of them can be read off the SQL:
 *
 *  - `id` is `GENERATED ALWAYS AS IDENTITY` on all four tables, so an insert
 *    that tried to carry an id is refused by the engine, not by a type. The
 *    stakes are the whole point of 2.0.0: a renumbered device id silently
 *    rebinds five years of `metrics_raw` to a different machine.
 *  - `ON CONFLICT (plant_id, slug) DO NOTHING` reuses a row only if the unique
 *    constraint is really there and really spans those two columns.
 *  - `devices_connection_unit_key` is a unique INDEX rather than a constraint
 *    precisely so two endpoint-less devices (`connection_id IS NULL`) do not
 *    collide, and whether NULLs are distinct is an engine behaviour.
 *  - the `arrays` column is JSONB, so what comes back out of it is whatever the
 *    driver decides — an assertion on the SQL text proves nothing about it.
 */
import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { databaseReachable, resetTestDatabase } from "./harness";

const reachable = await databaseReachable();
if (!reachable) {
  const message = "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}
const suite = reachable ? describe : describe.skip;

suite("the dimension spine", () => {
  let db: Awaited<ReturnType<typeof client>>;
  let repo: typeof import("@SunReye/db/plant-repo");

  async function client() {
    const url = await resetTestDatabase();
    const { createDbAt } = await import("@SunReye/db");
    return createDbAt(url);
  }

  /** The error a statement raised, or "" — see baseline.test.ts on `.rejects`. */
  async function failure(query: ReturnType<typeof sql>): Promise<string> {
    try {
      await db.execute(query);
      return "";
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause;
      // The constraint name lives ONLY on the cause.
      return `${(error as Error).message} ${cause instanceof Error ? cause.message : ""}`;
    }
  }

  /**
   * A plant of this spec's own.
   *
   * Inserted directly rather than through `ensurePlant`, because `ensurePlant`
   * ADOPTS whatever plant the install already has (that is its contract — see
   * the idempotency test below) and this suite shares one database with every
   * other spec in this directory.
   */
  async function freshPlant(slug: string) {
    await db.execute(sql`insert into plants (name, slug) values (${slug}, ${slug})`);
    const { rows } = await db.execute(sql`select id from plants where slug = ${slug}`);
    return { id: Number((rows[0] as { id: number }).id) };
  }

  test("setup", async () => {
    db = await client();
    repo = await import("@SunReye/db/plant-repo");
    expect(repo.ensurePlant).toBeInstanceOf(Function);
  });

  test("createPlant writes every column, JSONB cast and defaults included", async () => {
    const created = await repo.createPlant(db, {
      name: "Seeded",
      slug: "spine-seed",
      timeZone: "Europe/Berlin",
      biddingZone: "DE-LU",
      facts: { latitude: 50.4, systemLoss: 11, arrays: [{ kwp: 9.8, tilt: 30, azimuth: 0 }] },
    });
    expect(created.latitude).toBe(50.4);
    expect(created.systemLoss).toBe(11);
    expect(created.timeZone).toBe("Europe/Berlin");
    expect(created.biddingZone).toBe("DE-LU");
    expect(created.arrays).toEqual([{ kwp: 9.8, tilt: 30, azimuth: 0 }]);
    // Unstated facts take the COLUMN defaults, not zeros.
    expect(created.tempCoefficient).toBe(-0.4);
    expect(created.longitude).toBeNull();
    expect(created.tariffKey).toBeNull();
  });

  test("createPlant on an existing slug adopts that row rather than renumbering", async () => {
    // The concurrent-boot race: `ON CONFLICT (slug) DO NOTHING` must return the
    // winner's row, and the loser's defaults must not overwrite it.
    const first = await repo.createPlant(db, { name: "Race", slug: "spine-race" });
    const second = await repo.createPlant(db, {
      name: "Loser",
      slug: "spine-race",
      facts: { systemLoss: 42 },
    });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Race");
    expect(second.systemLoss).toBe(14);
  });

  test("ensurePlant ADOPTS the install's plant — never a second one, never a rename", async () => {
    // The idempotency requirement, and the reason it is not "insert if my slug
    // is absent": an install whose plant is called something else entirely must
    // be joined, not duplicated. int2 identity means a duplicate would take a
    // NEW id, and every historical reading would keep pointing at the old one.
    const before = await repo.readPlant(db);
    if (before === null) throw new Error("this suite already created a plant");
    const { rows: countBefore } = await db.execute(sql`select count(*)::int as n from plants`);
    const adopted = await repo.ensurePlant(db, {
      name: "a different name",
      slug: "a-different-slug",
      facts: { systemLoss: 77 },
    });
    const again = await repo.ensurePlant(db, { name: "third boot", slug: "third-slug" });
    const { rows: countAfter } = await db.execute(sql`select count(*)::int as n from plants`);
    expect(adopted.id).toBe(before.id);
    expect(again.id).toBe(before.id);
    expect(adopted.slug).toBe(before.slug);
    expect(adopted.name).toBe(before.name);
    expect(adopted.systemLoss).toBe(before.systemLoss);
    expect((countAfter[0] as { n: number }).n).toBe((countBefore[0] as { n: number }).n);
  });

  test("the id is GENERATED ALWAYS — a supplied one is refused by the engine", async () => {
    // A restore script or a well-meant INSERT carrying the old row's number is
    // the failure mode: every reading holds this int2.
    const message = await failure(
      sql`insert into plants (id, name, slug) values (99, 'x', 'spine-forced')`,
    );
    expect(message).toContain('cannot insert a non-DEFAULT value into column "id"');
  });

  test("a plant's facts read back as the columns they are, JSONB arrays included", async () => {
    const plant = await freshPlant("spine-facts");
    await repo.updatePlant(db, plant.id, {
      latitude: 50.4,
      longitude: 8.06,
      label: "Limburg",
      arrays: [
        { kwp: 9.8, tilt: 30, azimuth: 0 },
        { kwp: 3.2, tilt: 15, azimuth: -90 },
      ],
      maxOutputW: 7000,
      smartMeterSince: "2026-03-01",
    });
    const read = await repo.readPlant(db, plant.id);
    expect(read?.latitude).toBe(50.4);
    expect(read?.label).toBe("Limburg");
    expect(read?.arrays).toEqual([
      { kwp: 9.8, tilt: 30, azimuth: 0 },
      { kwp: 3.2, tilt: 15, azimuth: -90 },
    ]);
    expect(read?.maxOutputW).toBe(7000);
    expect(read?.smartMeterSince).toBe("2026-03-01");
  });

  test("updatePlant touches ONLY the columns it names — the clobber, at the engine", async () => {
    const plant = await freshPlant("spine-partial");
    await repo.updatePlant(db, plant.id, {
      systemLoss: 11,
      arrays: [{ kwp: 5, tilt: 20, azimuth: 0 }],
    });
    // The second save is the "other settings page": it names the location only.
    await repo.updatePlant(db, plant.id, { latitude: 1, longitude: 2 });
    const read = await repo.readPlant(db, plant.id);
    expect(read?.systemLoss).toBe(11);
    expect(read?.arrays).toEqual([{ kwp: 5, tilt: 20, azimuth: 0 }]);
    expect(read?.latitude).toBe(1);
  });

  test("an empty patch is a no-op, not an UPDATE with no assignments", async () => {
    // `update plants set where id = 1` is a syntax error, and an empty patch is
    // reachable: a form that changed nothing sends nothing.
    const plant = await freshPlant("spine-empty");
    await repo.updatePlant(db, plant.id, {});
    expect((await repo.readPlant(db, plant.id))?.id).toBe(plant.id);
  });

  test("null clears a nullable column and 0 is not null", async () => {
    const plant = await freshPlant("spine-nulls");
    await repo.updatePlant(db, plant.id, { houseLoadW: 0, maxOutputW: 7000 });
    expect((await repo.readPlant(db, plant.id))?.houseLoadW).toBe(0);
    await repo.updatePlant(db, plant.id, { maxOutputW: null });
    const read = await repo.readPlant(db, plant.id);
    expect(read?.maxOutputW).toBeNull();
    expect(read?.houseLoadW).toBe(0);
  });

  test("ensureConnection creates one endpoint and then EDITS it, never a second", async () => {
    // Changing the gateway's port must touch one row: `(host, port)` is not a
    // device key, and a second row would leave the device pointing at the old one.
    const plant = await freshPlant("spine-conn");
    const first = await repo.ensureConnection(db, plant.id, {
      name: "Inverter",
      host: "10.0.0.5",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
    const second = await repo.ensureConnection(db, plant.id, {
      name: "Inverter",
      host: "10.0.0.9",
      port: 8899,
      transport: "rtu-over-tcp",
      timeoutMs: 3000,
      pollIntervalMs: 2000,
    });
    expect(second.id).toBe(first.id);
    expect(second.host).toBe("10.0.0.9");
    expect(second.port).toBe(8899);
    expect(second.transport).toBe("rtu-over-tcp");
    const { rows } = await db.execute(
      sql`select count(*)::int as n from connections where plant_id = ${plant.id}`,
    );
    expect((rows[0] as { n: number }).n).toBe(1);
  });

  test("createConnection adds a SECOND endpoint to the plant — the first is untouched", async () => {
    // The add-device dialog's "new connection": a second gateway must not move
    // the first one, which is exactly what `ensureConnection` would have done.
    const plant = await freshPlant("spine-conn-create");
    const first = await repo.ensureConnection(db, plant.id, {
      name: "Gateway 1",
      host: "10.0.0.5",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
    const second = await repo.createConnection(db, plant.id, {
      name: "Gateway 2",
      host: "10.0.0.9",
      port: 8899,
      transport: "rtu-over-tcp",
      timeoutMs: 3000,
      pollIntervalMs: 2000,
    });
    expect(second.id).not.toBe(first.id);
    expect(second.transport).toBe("rtu-over-tcp");
    const all = await repo.readConnections(db, plant.id);
    expect(all.map((c) => c.host)).toEqual(["10.0.0.5", "10.0.0.9"]);
  });

  test("updateConnection edits in place — the device bound to it follows, the id stays", async () => {
    const plant = await freshPlant("spine-conn-update");
    const gateway = await repo.createConnection(db, plant.id, {
      name: "G",
      host: "10.0.0.5",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
    const device = await repo.createDevice(db, {
      plantId: plant.id,
      connectionId: gateway.id,
      unitId: 1,
      slug: "inv",
      name: "Inv",
      profileId: "p",
      role: "inverter",
    });
    const moved = await repo.updateConnection(db, gateway.id, {
      host: "10.0.0.9",
      transport: "rtu-over-tcp",
    });
    expect(moved.id).toBe(gateway.id);
    expect(moved.host).toBe("10.0.0.9");
    expect(moved.transport).toBe("rtu-over-tcp");
    expect(moved.port).toBe(502);
    const [after] = await repo.readDevices(db, plant.id);
    expect(after?.id).toBe(device.id);
    expect(after?.connectionId).toBe(gateway.id);
  });

  test("updateConnection refuses a transport the CHECK does not admit", async () => {
    const plant = await freshPlant("spine-conn-update-check");
    const gateway = await repo.createConnection(db, plant.id, {
      name: "G",
      host: "h",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
    let message = "";
    try {
      await repo.updateConnection(db, gateway.id, { transport: "carrier-pigeon" });
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause;
      message = `${(error as Error).message} ${cause instanceof Error ? cause.message : ""}`;
    }
    expect(message).toContain("connections_transport_check");
  });

  test("deleteConnection removes an unreferenced endpoint and is refused for a bound one BY THE ENGINE", async () => {
    const plant = await freshPlant("spine-conn-delete");
    const spare = await repo.createConnection(db, plant.id, {
      name: "Spare",
      host: "h",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
    const bound = await repo.createConnection(db, plant.id, {
      name: "Bound",
      host: "h2",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
    await repo.createDevice(db, {
      plantId: plant.id,
      connectionId: bound.id,
      unitId: 1,
      slug: "inv",
      name: "Inv",
      profileId: "p",
      role: "inverter",
    });
    expect(await repo.deleteConnection(db, spare.id)).toBe(true);
    expect(await repo.deleteConnection(db, spare.id)).toBe(false);
    let message = "";
    try {
      await repo.deleteConnection(db, bound.id);
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause;
      message = `${(error as Error).message} ${cause instanceof Error ? cause.message : ""}`;
    }
    expect(message).toContain("devices_connection_id_connections_id_fk");
    expect((await repo.readConnections(db, plant.id)).map((c) => c.id)).toEqual([bound.id]);
  });

  test("createDevice refuses a second device on the same (connection, unit id) BY THE ENGINE", async () => {
    // `devices_connection_unit_key` — and the violation has to be recognisable so
    // the add-device route can answer 409 with a reason instead of 500.
    const plant = await freshPlant("spine-dev-create-unit");
    const gateway = await repo.createConnection(db, plant.id, {
      name: "Gateway",
      host: "10.0.0.5",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
    const spec = {
      plantId: plant.id,
      connectionId: gateway.id,
      unitId: 1,
      slug: "inverter",
      name: "Inverter",
      profileId: "p",
      role: "inverter",
    };
    const created = await repo.createDevice(db, spec);
    expect(created.id).toBeGreaterThan(0);
    expect(created.retiredAt).toBeNull();
    let caught: unknown = null;
    try {
      await repo.createDevice(db, { ...spec, slug: "meter", name: "Meter", role: "meter" });
    } catch (error) {
      caught = error;
    }
    expect(repo.uniqueViolation(caught)).toBe("devices_connection_unit_key");
  });

  test("createDevice refuses a slug the plant already uses, and names that constraint", async () => {
    const plant = await freshPlant("spine-dev-create-slug");
    const spec = {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      slug: "inverter",
      name: "Inverter",
      profileId: "p",
      role: "inverter",
    };
    await repo.createDevice(db, spec);
    let caught: unknown = null;
    try {
      await repo.createDevice(db, { ...spec, unitId: 2 });
    } catch (error) {
      caught = error;
    }
    expect(repo.uniqueViolation(caught)).toBe("devices_plant_slug_key");
  });

  test("createDevice lets two endpoint-less devices share a unit id — NULLs are distinct", async () => {
    const plant = await freshPlant("spine-dev-create-null");
    const spec = {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      slug: "a",
      name: "A",
      profileId: "p",
      role: "inverter",
    };
    const a = await repo.createDevice(db, spec);
    const b = await repo.createDevice(db, { ...spec, slug: "b", name: "B" });
    expect(b.id).not.toBe(a.id);
  });

  test("readConnections lists EVERY endpoint of the plant, and only that plant's", async () => {
    // The poll loop resolves each device's endpoint through its own
    // `connection_id` (`apps/server/src/inverter/endpoint.ts`), so it needs the
    // whole set. Against a real engine because the claim is about what the
    // statement returns and in what order — `connections` has no unique key, so
    // two gateways really are two rows, and a plant filter that leaked would
    // point one plant's device at another plant's address.
    const plant = await freshPlant("spine-conns");
    const other = await freshPlant("spine-conns-other");
    const first = await repo.ensureConnection(db, plant.id, {
      name: "GX gateway",
      host: "10.0.0.5",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
    // A SECOND endpoint on the same plant — two gateways, which `ensureConnection`
    // deliberately cannot create (it edits in place), so this is a raw insert.
    await db.execute(sql`
      insert into connections (plant_id, name, host, port, transport, timeout_ms, poll_interval_ms)
      values (${plant.id}, 'RS485 bridge', '10.0.0.6', 8899, 'rtu-over-tcp', 3000, 5000)`);
    await repo.ensureConnection(db, other.id, {
      name: "Elsewhere",
      host: "10.9.9.9",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });

    const listed = await repo.readConnections(db, plant.id);
    expect(listed.map((c) => c.host)).toEqual(["10.0.0.5", "10.0.0.6"]);
    expect(listed[0]?.id).toBe(first.id);
    // Coercions, which only a real driver can prove: these columns are `integer`.
    expect(listed[1]).toMatchObject({
      port: 8899,
      transport: "rtu-over-tcp",
      timeoutMs: 3000,
      pollIntervalMs: 5000,
    });
    // The single-endpoint reader is the first of the same list.
    expect((await repo.readConnection(db, plant.id))?.id).toBe(first.id);

    const none = await freshPlant("spine-conns-none");
    expect(await repo.readConnections(db, none.id)).toEqual([]);
    expect(await repo.readConnection(db, none.id)).toBeNull();
  });

  test("ensureDevice creates once, keeps the id and the slug, and re-points the profile", async () => {
    // A profile SWAP is the headline bug of 2.0.0: in 1.x it orphaned every row
    // of history. The device must survive it with its id intact.
    const plant = await freshPlant("spine-dev");
    const first = await repo.ensureDevice(db, {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      slug: "inverter",
      name: "Inverter",
      profileId: "deye-sun-12k",
      role: "inverter",
    });
    const swapped = await repo.updateDevice(db, first.id, { profileId: "sigenergy-hybrid" });
    expect(swapped.id).toBe(first.id);
    expect(swapped.slug).toBe("inverter");
    expect(swapped.profileId).toBe("sigenergy-hybrid");

    const again = await repo.ensureDevice(db, {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      slug: "inverter",
      name: "A renamed default",
      profileId: "sigenergy-hybrid",
      role: "inverter",
    });
    expect(again.id).toBe(first.id);
    expect(again.name).toBe("Inverter");
  });

  test("two endpoint-less devices coexist — NULLs are distinct in that unique index", async () => {
    // Simulate mode and an imported history both produce a device with no
    // endpoint, and `devices_connection_unit_key` is an INDEX for this reason.
    const plant = await freshPlant("spine-null-conn");
    const a = await repo.ensureDevice(db, {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      slug: "sim-a",
      name: "A",
      profileId: "p",
      role: "inverter",
    });
    const b = await repo.ensureDevice(db, {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      slug: "sim-b",
      name: "B",
      profileId: "p",
      role: "controller",
    });
    expect(b.id).not.toBe(a.id);
  });

  test("an inverter's PV description lives on its row — written, read back, defaulted", async () => {
    const plant = await freshPlant("spine-device-pv");
    const created = await repo.createDevice(db, {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      slug: "inv",
      name: "Inv",
      profileId: "p",
      role: "inverter",
      pv: {
        arrays: [
          { kwp: 8.4, tilt: 35, azimuth: 0 },
          { kwp: 3.2, tilt: 20, azimuth: 90, systemLoss: 20 },
        ],
        tempCoefficient: -0.35,
      },
    });
    expect(created.arrays).toHaveLength(2);
    expect(created.arrays[1]?.systemLoss).toBe(20);
    expect(created.tempCoefficient).toBe(-0.35);
    expect(created.systemLoss).toBe(14); // the column default
    const meter = await repo.createDevice(db, {
      plantId: plant.id,
      connectionId: null,
      unitId: 2,
      slug: "meter",
      name: "M",
      profileId: "p",
      role: "meter",
    });
    expect(meter.arrays).toEqual([]);
    const patched = await repo.updateDevice(db, created.id, { pv: { systemLoss: 9, arrays: [] } });
    expect(patched.systemLoss).toBe(9);
    expect(patched.arrays).toEqual([]);
    expect(patched.tempCoefficient).toBe(-0.35);
  });

  test("migration 0005's backfill moves the plant's PV description onto its FIRST in-service inverter only", async () => {
    // The statement is read from the migration file itself, so this proves the
    // SQL that ships — not a re-typed copy of it.
    const file = await Bun.file(
      new URL("../../../packages/db/src/migrations/0005_mean_rhodey.sql", import.meta.url),
    ).text();
    const backfill = file.slice(file.indexOf("UPDATE"));
    const plant = await freshPlant("spine-pv-backfill");
    await db.execute(sql`update plants set arrays = '[{"kwp": 9.8, "tilt": 30, "azimuth": 0}]'::jsonb,
      temp_coefficient = -0.3, system_loss = 11 where id = ${plant.id}`);
    const spec = {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      slug: "old",
      name: "Old",
      profileId: "p",
      role: "inverter",
    };
    const retired = await repo.createDevice(db, spec);
    await repo.updateDevice(db, retired.id, { retiredAt: new Date() });
    const first = await repo.createDevice(db, { ...spec, unitId: 2, slug: "inv-1", name: "One" });
    const second = await repo.createDevice(db, { ...spec, unitId: 3, slug: "inv-2", name: "Two" });
    const meter = await repo.createDevice(db, {
      ...spec,
      unitId: 4,
      slug: "meter",
      name: "M",
      role: "meter",
    });
    await db.execute(sql.raw(backfill));
    const after = new Map((await repo.readDevices(db, plant.id)).map((d) => [d.slug, d]));
    expect(after.get("inv-1")?.arrays).toEqual([{ kwp: 9.8, tilt: 30, azimuth: 0 }]);
    expect(after.get("inv-1")?.tempCoefficient).toBe(-0.3);
    expect(after.get("inv-1")?.systemLoss).toBe(11);
    for (const slug of ["old", "inv-2", "meter"]) {
      expect(after.get(slug)?.arrays).toEqual([]);
      expect(after.get(slug)?.systemLoss).toBe(14);
    }
    expect([retired.id, first.id, second.id, meter.id].every((id) => id > 0)).toBe(true);
  });

  test("readDevices returns the plant's devices with their roles", async () => {
    const plant = await freshPlant("spine-roles");
    await repo.ensureDevice(db, {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      slug: "inv",
      name: "Inv",
      profileId: "p",
      role: "inverter",
    });
    await repo.ensureDevice(db, {
      plantId: plant.id,
      connectionId: null,
      unitId: 2,
      slug: "gx",
      name: "GX",
      profileId: "p",
      role: "controller",
    });
    const devices = await repo.readDevices(db, plant.id);
    expect(devices.map((d) => d.role).sort()).toEqual(["controller", "inverter"]);
  });

  test("a pack is upserted per device, and read back for the derivation", async () => {
    const plant = await freshPlant("spine-packs");
    const big = await repo.ensureDevice(db, {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      slug: "big",
      name: "Big",
      profileId: "p",
      role: "inverter",
    });
    const small = await repo.ensureDevice(db, {
      plantId: plant.id,
      connectionId: null,
      unitId: 2,
      slug: "small",
      name: "Small",
      profileId: "p",
      role: "inverter",
    });
    await repo.upsertDeviceBattery(db, big.id, {
      usableKwh: 30,
      maxChargeW: 9000,
      minSoc: 5,
      nominalV: 48,
    });
    // Upserting again must UPDATE the one row (deviceId is unique), not fail.
    await repo.upsertDeviceBattery(db, big.id, {
      usableKwh: 30,
      maxChargeW: 9000,
      minSoc: 5,
      nominalV: 51.2,
    });
    await repo.upsertDeviceBattery(db, small.id, {
      usableKwh: 5,
      maxChargeW: 2500,
      minSoc: 50,
      nominalV: null,
    });
    const packs = await repo.readPlantBatteries(db, plant.id);
    expect(packs.length).toBe(2);
    expect(packs.find((p) => p.usableKwh === 30)?.nominalV).toBe(51.2);
    expect(packs.find((p) => p.usableKwh === 5)?.nominalV).toBeNull();
  });

  test("deleting a pack leaves the device — the plant then has no storage", async () => {
    const plant = await freshPlant("spine-nopack");
    const device = await repo.ensureDevice(db, {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      slug: "d",
      name: "D",
      profileId: "p",
      role: "inverter",
    });
    await repo.upsertDeviceBattery(db, device.id, {
      usableKwh: 10,
      maxChargeW: null,
      minSoc: 10,
      nominalV: null,
    });
    await repo.deleteDeviceBattery(db, device.id);
    expect(await repo.readPlantBatteries(db, plant.id)).toEqual([]);
    expect((await repo.readDevices(db, plant.id)).length).toBe(1);
  });

  test("readRawSetting returns the stored JSONB verbatim, schema or no schema", async () => {
    // The seeding path must see what is REALLY there: `readSetting` safeParses
    // to the default with no log, so a blob the current schema rejects would
    // read as "never configured" and its values would be lost.
    await db.execute(
      sql`insert into app_settings (key, value) values ('spine-raw', ${JSON.stringify({ forecast: { arrays: [{ kwp: 9.8, tilt: 400, azimuth: 0 }] } })}::jsonb)
          on conflict (key) do update set value = excluded.value`,
    );
    const raw = await repo.readRawSetting(db, "spine-raw");
    expect(raw).toEqual({ forecast: { arrays: [{ kwp: 9.8, tilt: 400, azimuth: 0 }] } });
    expect(await repo.readRawSetting(db, "spine-absent")).toBeUndefined();
  });

  /**
   * THE ONE-TIME SLUG CORRECTION, which exists nowhere else in the repository.
   *
   * `updatePlant` and `updateDevice` cannot express a slug and never will — a
   * slug exists so it never has to change. `reslugForMigrationOnboarding` is the
   * separate, narrow path the 1.2.0 -> 2.0.0 onboarding form writes through, open
   * only while Home Assistant discovery is still held
   * (`apps/server/src/migration/onboarding-plan.ts` decides that; this is only the
   * statement). It is proved HERE because both of its interesting properties are
   * the engine's: whether `plants_slug_unique` really refuses a collision, and
   * whether the update leaves the row's id — and therefore five years of
   * `metrics_raw.device_id` — exactly where it was.
   */
  test("reslugForMigrationOnboarding moves both slugs and keeps both ids", async () => {
    const plant = await freshPlant("spine-reslug");
    const device = await repo.ensureDevice(db, {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      slug: "inverter",
      name: "Inverter",
      profileId: "spine-reslug-profile",
      role: "inverter",
    });

    await repo.reslugForMigrationOnboarding(db, {
      plantId: plant.id,
      plantSlug: "haus-sud",
      deviceId: device.id,
      deviceSlug: "wechselrichter",
    });

    const { rows } = await db.execute(
      sql`select p.id as plant_id, p.slug as plant_slug, d.id as device_id, d.slug as device_slug
            from plants p join devices d on d.plant_id = p.id
           where p.id = ${plant.id}`,
    );
    expect(rows[0]).toMatchObject({
      plant_id: plant.id,
      plant_slug: "haus-sud",
      device_id: device.id,
      device_slug: "wechselrichter",
    });
  });

  test("each half is optional, so correcting one slug leaves the other alone", async () => {
    const plant = await freshPlant("spine-reslug-half");
    const device = await repo.ensureDevice(db, {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      slug: "inverter",
      name: "Inverter",
      profileId: "spine-reslug-half-profile",
      role: "inverter",
    });
    await repo.reslugForMigrationOnboarding(db, {
      plantId: plant.id,
      deviceId: device.id,
      deviceSlug: "wr-1",
    });
    const { rows } = await db.execute(
      sql`select p.slug as plant_slug, d.slug as device_slug
            from plants p join devices d on d.plant_id = p.id where p.id = ${plant.id}`,
    );
    expect(rows[0]).toMatchObject({ plant_slug: "spine-reslug-half", device_slug: "wr-1" });
  });

  test("naming nothing executes nothing — `set` with no assignments is a syntax error", async () => {
    const plant = await freshPlant("spine-reslug-none");
    await repo.reslugForMigrationOnboarding(db, { plantId: plant.id, deviceId: null });
    const { rows } = await db.execute(sql`select slug from plants where id = ${plant.id}`);
    expect((rows[0] as { slug: string }).slug).toBe("spine-reslug-none");
  });

  test("a slug already taken by another plant is refused BY THE ENGINE", async () => {
    // The reason this needs a real Postgres: the refusal is `plants_slug_key`, not
    // a check in TypeScript. Without it the correction would either 500 or, worse,
    // succeed against a database whose unique index had been lost.
    await freshPlant("spine-reslug-taken");
    const plant = await freshPlant("spine-reslug-mover");
    let message = "";
    try {
      await repo.reslugForMigrationOnboarding(db, {
        plantId: plant.id,
        plantSlug: "spine-reslug-taken",
        deviceId: null,
      });
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause;
      message = `${(error as Error).message} ${cause instanceof Error ? cause.message : ""}`;
    }
    expect(message).toContain("plants_slug_unique");
  });

  test("and a device slug already used inside the same plant is refused too", async () => {
    const plant = await freshPlant("spine-reslug-dev-dup");
    const taken = await repo.ensureDevice(db, {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      slug: "inverter",
      name: "A",
      profileId: "spine-reslug-dup-a",
      role: "inverter",
    });
    const mover = await repo.ensureDevice(db, {
      plantId: plant.id,
      connectionId: null,
      unitId: 2,
      slug: "controller",
      name: "B",
      profileId: "spine-reslug-dup-b",
      role: "controller",
    });
    expect(mover.id).not.toBe(taken.id);
    let message = "";
    try {
      await repo.reslugForMigrationOnboarding(db, {
        plantId: plant.id,
        deviceId: mover.id,
        deviceSlug: "inverter",
      });
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause;
      message = `${(error as Error).message} ${cause instanceof Error ? cause.message : ""}`;
    }
    expect(message).toContain("devices_plant_slug_key");
  });

  test("a device row is what lets a reading be stored at all", async () => {
    // The end-to-end point of this wave: before provisioning, the writer's
    // resolve returns null and drops the batch.
    const plant = await freshPlant("spine-write");
    const { resolveDeviceId } = await import("../src/shared/identity");
    expect(await resolveDeviceId(db, "spine-write-profile")).toBeNull();
    const device = await repo.ensureDevice(db, {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      slug: "spine-write-dev",
      name: "D",
      profileId: "spine-write-profile",
      role: "inverter",
    });
    // Resolved by SLUG, and by the transitional profile_id arm alike.
    expect(await resolveDeviceId(db, "spine-write-dev")).toBe(device.id);
    expect(await resolveDeviceId(db, "spine-write-profile")).toBe(device.id);
  });

  describe("retirement: the only way a device leaves service", () => {
    /**
     * Why the column has to exist.
     *
     * `metrics_raw.device_id` references `devices` `ON DELETE RESTRICT`, which is
     * correct — the readings are the point, and deleting the device would
     * destroy the meaning of every row it wrote. The consequence is that there
     * was NO way to take a device out of service: it would be polled forever, or
     * the row worked around. `retired_at` is the lifecycle flag RESTRICT makes
     * necessary, and every claim below is about what Postgres does with it.
     */
    async function retiredFixture(slug: string) {
      const plant = await freshPlant(`${slug}-plant`);
      const device = await repo.ensureDevice(db, {
        plantId: plant.id,
        connectionId: null,
        unitId: 90,
        slug,
        name: slug,
        profileId: "p",
        role: "inverter",
      });
      return { plant, device };
    }

    test("a new device is in service — the column defaults to NULL, not to now()", async () => {
      const { device } = await retiredFixture("retire-fresh");
      expect(device.retiredAt).toBeNull();
    });

    test("retiring keeps the row and its id", async () => {
      const { device } = await retiredFixture("retire-keeps-id");
      const at = new Date("2026-08-01T10:00:00Z");
      const updated = await repo.updateDevice(db, device.id, { retiredAt: at });
      expect(updated.id).toBe(device.id);
      expect(updated.retiredAt?.toISOString()).toBe("2026-08-01T10:00:00.000Z");
    });

    test("a retired device is excluded from the active list and present in the full one", async () => {
      const { plant, device } = await retiredFixture("retire-listing");
      await repo.updateDevice(db, device.id, { retiredAt: new Date() });
      const all = await repo.readDevices(db, plant.id);
      const active = await repo.readDevices(db, plant.id, { includeRetired: false });
      expect(all.map((d) => d.id)).toContain(device.id);
      expect(active.map((d) => d.id)).not.toContain(device.id);
    });

    test("its readings stay readable — retirement retains history, it does not hide it", async () => {
      const { plant, device } = await retiredFixture("retire-history");
      const { ensureMetricKeys } = await import("@SunReye/db/metric-keys");
      const ids = await ensureMetricKeys(db, [
        { key: "retire.power", isCounter: false, unit: "W" },
      ]);
      const metricId = ids.get("retire.power") ?? 0;
      await db.execute(sql`
        insert into metrics_raw (time, value, dur_ms, device_id, metric_id)
        values (now(), 1234, 1000, ${device.id}, ${metricId})`);
      await repo.updateDevice(db, device.id, { retiredAt: new Date() });
      const { rows } = await db.execute(sql`
        select count(*)::int as n from metrics_raw where device_id = ${device.id}`);
      expect(Number((rows[0] as { n: number }).n)).toBe(1);
      // And the plant still has exactly one device row, retired or not.
      const all = await repo.readDevices(db, plant.id);
      expect(all).toHaveLength(1);
    });

    test("a retired device with readings still cannot be DELETEd — RESTRICT is why this column exists", async () => {
      const { device } = await retiredFixture("retire-restrict");
      const { ensureMetricKeys } = await import("@SunReye/db/metric-keys");
      const ids = await ensureMetricKeys(db, [{ key: "retire.restrict", isCounter: false }]);
      await db.execute(sql`
        insert into metrics_raw (time, value, dur_ms, device_id, metric_id)
        values (now(), 1, 1000, ${device.id}, ${ids.get("retire.restrict") ?? 0})`);
      await repo.updateDevice(db, device.id, { retiredAt: new Date() });
      expect(await failure(sql`delete from devices where id = ${device.id}`)).toContain("violates");
    });

    test("un-retiring is an UPDATE back to NULL, and the device returns to the active list", async () => {
      const { plant, device } = await retiredFixture("retire-return");
      await repo.updateDevice(db, device.id, { retiredAt: new Date() });
      const back = await repo.updateDevice(db, device.id, { retiredAt: null });
      expect(back.retiredAt).toBeNull();
      const active = await repo.readDevices(db, plant.id, { includeRetired: false });
      expect(active.map((d) => d.id)).toContain(device.id);
    });

    test("retirement does not free the (connection, unit) slot or the slug", async () => {
      // The uniqueness constraints are unconditional on purpose: a retired
      // device's slug is still written into years of exports and saved charts,
      // and re-using it would make two different machines share one name.
      const plant = await freshPlant("retire-unique-plant");
      const conn = await repo.ensureConnection(db, plant.id, {
        name: "gx",
        host: "10.0.0.7",
        port: 502,
        transport: "tcp",
        timeoutMs: 2000,
        pollIntervalMs: 1000,
      });
      const device = await repo.ensureDevice(db, {
        plantId: plant.id,
        connectionId: conn.id,
        unitId: 91,
        slug: "retire-unique",
        name: "u",
        profileId: "p",
        role: "inverter",
      });
      await repo.updateDevice(db, device.id, { retiredAt: new Date() });
      expect(
        await failure(sql`
          insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
          values (${plant.id}, ${conn.id}, 91, 'retire-unique-2', 'u2', 'p', 'inverter')`),
      ).toContain("devices_connection_unit_key");
      // `ensureDevice` on the retired slug ADOPTS the retired row rather than
      // inserting a second one, which is exactly why the caller must consult the
      // flag before treating what it gets back as pollable.
      const readopted = await repo.ensureDevice(db, {
        plantId: plant.id,
        connectionId: conn.id,
        unitId: 91,
        slug: "retire-unique",
        name: "u",
        profileId: "p",
        role: "inverter",
      });
      expect(readopted.id).toBe(device.id);
      expect(readopted.retiredAt).not.toBeNull();
    });
  });
});
