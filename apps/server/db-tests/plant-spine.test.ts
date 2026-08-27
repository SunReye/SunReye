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
});
