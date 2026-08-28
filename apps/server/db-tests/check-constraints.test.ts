/**
 * The schema's CHECK constraints, proved the only way they can be: by inserting
 * a row that violates one and watching Postgres refuse it.
 *
 * WHY THESE EXIST AT ALL
 *
 * Until 2.0.0 the schema had ZERO check constraints. Every one of these
 * invariants was enforced by a Zod schema at an HTTP edge — and three write
 * paths never pass an edge: the archive import
 * (`packages/db/src/archive-import.ts`), the bucket replay
 * (`packages/db/src/replay.ts`) and the in-place 1.2.0 upgrade. A `min_soc` of
 * 150 or a `month` of 13 was accepted by the database, and the row it produced
 * was then read by the forecast model and the peak-shaving engine, which write
 * inverter registers.
 *
 * WHY NOT A CATALOG QUERY
 *
 * Reading a constraint's definition out of `pg_constraint`, or grepping the
 * migration text, proves that a string exists. It does not prove the constraint
 * is ENFORCED, that it spans the columns it names, or that the expression means
 * what it reads like — a `between` on a double, a null against an `in` list, an
 * enum spelled differently from the Zod enum it is supposed to mirror. So every
 * test here executes a real INSERT or UPDATE and asserts on the engine's answer.
 * The valid-row half matters just as much: a constraint that rejects what the
 * shipping code writes is an outage, not a safeguard.
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

suite("the schema's CHECK constraints", () => {
  let db: Awaited<ReturnType<typeof client>>;
  /** The plant every fixture row hangs off. */
  let plantId = 0;
  let connectionId = 0;
  let deviceId = 0;

  async function client() {
    const url = await resetTestDatabase();
    const { createDbAt } = await import("@SunReye/db");
    return createDbAt(url);
  }

  /**
   * The error a statement raised, or "" when it was accepted.
   *
   * The constraint NAME lives only on the driver's `cause`, and the name is the
   * part worth asserting: a test that only checks "something threw" passes when
   * a not-null violation, a type cast or a foreign key fires instead of the
   * check under test. Mirrors `plant-spine.test.ts`.
   */
  async function failure(query: ReturnType<typeof sql>): Promise<string> {
    try {
      await db.execute(query);
      return "";
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause;
      return `${(error as Error).message} ${cause instanceof Error ? cause.message : ""}`;
    }
  }

  async function one<T>(query: ReturnType<typeof sql>): Promise<T | undefined> {
    const { rows } = await db.execute(query);
    return rows[0] as T | undefined;
  }

  test("setup: a plant, an endpoint and a device to hang rows off", async () => {
    db = await client();
    const plant = await one<{ id: number }>(sql`
      insert into plants (name, slug) values ('Checks', 'checks') returning id`);
    plantId = Number(plant?.id);
    const conn = await one<{ id: number }>(sql`
      insert into connections (plant_id, name, host) values (${plantId}, 'gx', '10.0.0.2')
      returning id`);
    connectionId = Number(conn?.id);
    const device = await one<{ id: number }>(sql`
      insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
      values (${plantId}, ${connectionId}, 1, 'dev-1', 'Dev 1', 'p', 'inverter')
      returning id`);
    deviceId = Number(device?.id);
    expect(deviceId).toBeGreaterThan(0);
  });

  describe("devices.role", () => {
    // The role is what tells "this device reports the plant total" from "this
    // device is one of the inverters the total is summed from". A role outside
    // the modelled set makes every read that branches on it fall through
    // silently — the rows are counted in neither arm.
    test.each(["controller", "meter", "charger"])("%s is a modelled role", async (role) => {
      const unit = { controller: 10, meter: 11, charger: 12 }[role] ?? 20;
      expect(
        await failure(sql`
          insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
          values (${plantId}, ${connectionId}, ${unit}, ${`ok-${role}`}, 'n', 'p', ${role})`),
      ).toBe("");
    });

    test("an unmodelled role is refused", async () => {
      const error = await failure(sql`
        insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
        values (${plantId}, ${connectionId}, 30, 'bad-role', 'n', 'p', 'battery')`);
      expect(error).toContain("devices_role_check");
    });

    test("case matters — 'Inverter' is not the role the read layer matches on", async () => {
      const error = await failure(sql`
        insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
        values (${plantId}, ${connectionId}, 31, 'bad-case', 'n', 'p', 'Inverter')`);
      expect(error).toContain("devices_role_check");
    });

    test("an empty role is refused too, not treated as absent", async () => {
      const error = await failure(sql`
        insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
        values (${plantId}, ${connectionId}, 32, 'empty-role', 'n', 'p', '')`);
      expect(error).toContain("devices_role_check");
    });

    test("an UPDATE cannot walk a device out of the set either", async () => {
      const error = await failure(sql`update devices set role = 'pump' where id = ${deviceId}`);
      expect(error).toContain("devices_role_check");
    });
  });

  describe("connections.transport", () => {
    // Mirrors `inverterConfigSchema`'s `z.enum(["tcp", "rtu-over-tcp"])`
    // exactly. A third value reaches the Modbus client as a framing mode it
    // does not implement, so the endpoint never polls.
    test("rtu-over-tcp is accepted", async () => {
      expect(
        await failure(sql`
          insert into connections (plant_id, name, host, transport)
          values (${plantId}, 'rtu', '10.0.0.3', 'rtu-over-tcp')`),
      ).toBe("");
    });

    test("a transport the client cannot frame is refused", async () => {
      const error = await failure(sql`
        insert into connections (plant_id, name, host, transport)
        values (${plantId}, 'serial', '10.0.0.4', 'rtu')`);
      expect(error).toContain("connections_transport_check");
    });

    test("an UPDATE is checked as well", async () => {
      const error = await failure(sql`
        update connections set transport = 'udp' where id = ${connectionId}`);
      expect(error).toContain("connections_transport_check");
    });
  });

  describe("batteries.min_soc", () => {
    // `minSoc` is a PERCENTAGE, and `packages/db/src/batteries.ts` weights it by
    // capacity to derive the plant reserve floor. Above 100 the reserved energy
    // exceeds the pack, so the engine computes a negative usable window and
    // discharges nothing; below 0 it discharges past the DoD limit.
    test("the boundaries themselves are legal", async () => {
      expect(
        await failure(sql`
          insert into batteries (device_id, usable_kwh, min_soc) values (${deviceId}, 10, 0)`),
      ).toBe("");
      expect(
        await failure(sql`update batteries set min_soc = 100 where device_id = ${deviceId}`),
      ).toBe("");
    });

    test("101 is refused", async () => {
      const error = await failure(sql`
        update batteries set min_soc = 101 where device_id = ${deviceId}`);
      expect(error).toContain("batteries_min_soc_check");
    });

    test("a negative reserve is refused", async () => {
      const error = await failure(sql`
        update batteries set min_soc = -1 where device_id = ${deviceId}`);
      expect(error).toContain("batteries_min_soc_check");
    });

    test("a fractional reserve inside the range is legal — this is a double, not an int", async () => {
      expect(
        await failure(sql`update batteries set min_soc = 12.5 where device_id = ${deviceId}`),
      ).toBe("");
    });
  });

  describe("plants.temp_coefficient", () => {
    // The power temperature coefficient of Pmax is negative by definition: a
    // panel loses power as it heats. A POSITIVE value silently inverts the
    // derate, so the forecast predicts MORE power on the hottest afternoon —
    // and the peak-shaving plan built on that forecast under-charges the
    // battery before the evening peak.
    test("a negative coefficient is accepted", async () => {
      expect(
        await failure(sql`update plants set temp_coefficient = -0.35 where id = ${plantId}`),
      ).toBe("");
    });

    test("zero is accepted, because the settings edge accepts it", async () => {
      // `weather.ts` validates `z.number().min(-2).max(0)`, so 0 — "model no
      // temperature derate" — is a value the UI can already save. The CHECK
      // mirrors the edge rather than being one notch stricter, which would make
      // a saved plant unwritable.
      expect(await failure(sql`update plants set temp_coefficient = 0 where id = ${plantId}`)).toBe(
        "",
      );
    });

    test("a positive coefficient is refused", async () => {
      const error = await failure(sql`
        update plants set temp_coefficient = 0.4 where id = ${plantId}`);
      expect(error).toContain("plants_temp_coefficient_check");
    });

    test("the smallest positive value is refused too", async () => {
      const error = await failure(sql`
        update plants set temp_coefficient = 1e-9 where id = ${plantId}`);
      expect(error).toContain("plants_temp_coefficient_check");
    });
  });

  describe("forecast_correction_cells month and hour", () => {
    // The grid is keyed by plant-local `(month, hour)`. A cell outside the
    // calendar is never read back — the learner writes it, the forecast looks
    // up month 8 hour 14 and finds nothing — so the bias silently stops being
    // corrected instead of failing.
    const cell = (month: number, hour: number) => sql`
      insert into forecast_correction_cells (device_id, month, hour, ratio, weight)
      values (${deviceId}, ${month}, ${hour}, 1.0, 1.0)
      on conflict (device_id, month, hour) do update set ratio = excluded.ratio`;

    test("the corners of the calendar are legal", async () => {
      expect(await failure(cell(1, 0))).toBe("");
      expect(await failure(cell(12, 23))).toBe("");
    });

    test("month 13 is refused", async () => {
      expect(await failure(cell(13, 12))).toContain("forecast_correction_cells_month_hour_check");
    });

    test("month 0 is refused — months are 1-based here, unlike JavaScript's", async () => {
      expect(await failure(cell(0, 12))).toContain("forecast_correction_cells_month_hour_check");
    });

    test("hour 24 is refused", async () => {
      expect(await failure(cell(6, 24))).toContain("forecast_correction_cells_month_hour_check");
    });

    test("a negative hour is refused", async () => {
      expect(await failure(cell(6, -1))).toContain("forecast_correction_cells_month_hour_check");
    });
  });

  describe("spot_prices.slot_minutes", () => {
    // The nominal width is provenance, and `apps/server/src/statistics`'s spot
    // stats weight the average price BY it: `sum(price * slot_minutes) /
    // sum(slot_minutes)`. A zero or negative width divides by zero or flips the
    // sign of a day's mean price, which is the number §51 decisions read.
    const price = (minutes: number, iso: string) => sql`
      insert into spot_prices (zone, slot_start, slot_minutes, eur_per_mwh, provider)
      values ('DE-LU', ${iso}, ${minutes}, -12.5, 'energy-charts')`;

    test("the quarter-hour grid and an hourly source are both legal", async () => {
      expect(await failure(price(15, "2026-01-01T00:00:00Z"))).toBe("");
      expect(await failure(price(60, "2026-01-01T01:00:00Z"))).toBe("");
    });

    test("a 30-minute source is legal, because the ingest reads the width off the payload", async () => {
      // `providers/energy-charts.ts` derives `resolutionMinutes` from the first
      // gap in the series rather than assuming one, so a market publishing at
      // any other cadence writes that cadence. Pinning the CHECK to (15, 60)
      // would drop a whole delivery day's prices for such a zone.
      expect(await failure(price(30, "2026-01-01T02:00:00Z"))).toBe("");
    });

    test("a zero-width slot is refused — it is the denominator of the weighted mean", async () => {
      expect(await failure(price(0, "2026-01-01T03:00:00Z"))).toContain(
        "spot_prices_slot_minutes_check",
      );
    });

    test("a negative width is refused", async () => {
      expect(await failure(price(-15, "2026-01-01T04:00:00Z"))).toContain(
        "spot_prices_slot_minutes_check",
      );
    });
  });

  describe("the writers the constraints have to keep working", () => {
    // A CHECK that rejects what the shipping code writes is an outage. These
    // three go through the real repo functions rather than hand-written SQL.
    test("createPlant's defaults satisfy every plant check", async () => {
      const repo = await import("@SunReye/db/plant-repo");
      const created = await repo.createPlant(db, { name: "Defaults", slug: "checks-defaults" });
      expect(created.tempCoefficient).toBe(-0.4);
    });

    test("ensureConnection and ensureDevice write rows the checks accept", async () => {
      const repo = await import("@SunReye/db/plant-repo");
      const conn = await repo.ensureConnection(db, plantId, {
        name: "gx",
        host: "10.0.0.9",
        port: 502,
        transport: "tcp",
        timeoutMs: 2000,
        pollIntervalMs: 1000,
      });
      const device = await repo.ensureDevice(db, {
        plantId,
        connectionId: conn.id,
        unitId: 44,
        slug: "checks-writer",
        name: "Writer",
        profileId: "p",
        role: "inverter",
      });
      expect(device.role).toBe("inverter");
    });

    test("upsertDeviceBattery's default reserve satisfies the min_soc check", async () => {
      const repo = await import("@SunReye/db/plant-repo");
      const device = await repo.ensureDevice(db, {
        plantId,
        connectionId: null,
        unitId: 45,
        slug: "checks-pack",
        name: "Pack",
        profileId: "p",
        role: "inverter",
      });
      await repo.upsertDeviceBattery(db, device.id, {
        usableKwh: 14.3,
        minSoc: 10,
        maxChargeW: null,
        nominalV: null,
      });
      const packs = await repo.readPlantBatteries(db, plantId);
      expect(packs.some((p) => p.deviceId === device.id)).toBe(true);
    });
  });
});
