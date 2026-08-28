/**
 * The relational spine of the plant: plants, Modbus connections, devices and
 * battery packs. New in 2.0.0, and the reason that release breaks the schema.
 *
 * WHAT WAS WRONG
 *
 * There was no device entity and no plant entity at all.
 *
 * A reading's identity was `inverter_id`, and
 * `packages/inverter-core/src/driver.ts` stamped that from
 * `this.profile.id` — the PROFILE id. So two inverters of the same model wrote
 * to the same series, and switching a plant to a corrected or renamed profile
 * silently orphaned every row of history ever recorded: nothing was deleted,
 * nothing errored, the charts just went empty. That is the headline bug this
 * file exists to fix.
 *
 * "Plant" was a single `app_settings` JSONB row holding a time zone, while the
 * facts that actually describe a plant — coordinates, PV arrays, tilt and
 * azimuth, the export cap, the battery pack, the smart-meter date, the tariff,
 * the bidding zone — were scattered across the `weather`, `tariff` and
 * `spot-prices` keys of the same table.
 * `apps/web/src/lib/components/settings/plant-fields-placement.test.ts` exists
 * only because of that: two settings pages writing two halves of the `weather`
 * record read-modify-write over each other, and the loser's edit vanishes. With
 * each fact a COLUMN, an `UPDATE` touches only what it names, so that class of
 * bug is gone rather than guarded.
 *
 * ONE PLANT ROW, A REAL TABLE
 *
 * There is one plant today and there is no plan for a second. It is a table
 * anyway because the alternative — a JSONB row, or columns bolted onto some
 * singleton — is what has to be undone later, and re-keying a hypertable is the
 * expensive migration this release is spending its one clean break on.
 *
 * WHY THERE ARE CHECK CONSTRAINTS NOW
 *
 * Until this release the schema had none, and every invariant below was enforced
 * only by a Zod schema at an HTTP edge. Three write paths never pass an edge:
 * the archive import (`../archive-import.ts`), the bucket replay
 * (`../replay.ts`) and the in-place 1.2.0 upgrade. So a `min_soc` of 150 or a
 * positive temperature coefficient was accepted, and the row was then read by
 * the forecast model and the peak-shaving engine — which write inverter
 * registers. Each CHECK below mirrors its Zod schema EXACTLY rather than being a
 * notch stricter: a constraint that rejects a value the settings page can
 * already save turns a saved plant into an unwritable one. Every one is proved
 * by rejection in `apps/server/db-tests/check-constraints.test.ts`.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { createdAtTz, retiredAtTz } from "./columns";

/**
 * The plant (site).
 *
 * `slug` is FROZEN at onboarding: it becomes the MQTT namespace, so changing it
 * would orphan every discovered Home Assistant entity and every retained topic.
 * `name` is the editable label, and exists precisely so `slug` never has to
 * change — the two are separate for that reason alone.
 */
export const plants = pgTable(
  "plants",
  {
    id: smallint("id").generatedAlwaysAsIdentity().primaryKey(),
    /** User-facing label. Editable, always. */
    name: text("name").notNull(),
    /**
     * Stable machine name, frozen at onboarding — the MQTT namespace.
     *
     * Not derived from `name` on the fly for the same reason: a rename would move
     * every topic. Onboarding picks it once, from the name the operator typed.
     */
    slug: text("slug").notNull().unique(),
    /**
     * IANA zone the server buckets plant-local periods in, or `"auto"` to fall
     * back to the host process zone.
     *
     * The `"auto"` sentinel and its resolution order are unchanged from the
     * `app_settings` era — see `../plant.ts`'s `resolveServerZone`, which stays
     * the authority. This column only moves where the value is stored, so the
     * display-zone legacy fallback documented there keeps working.
     */
    timeZone: text("time_zone").notNull().default("auto"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    /** Friendly place name shown on the weather tile (e.g. "Limburg-Weilburg"). */
    label: text("label").notNull().default(""),

    /**
     * PV arrays: `[{ kwp, tilt, azimuth, deviceSlug?, tempCoefficient?,
     * systemLoss? }]`, azimuth in the Open-Meteo/PV convention (0 = south,
     * -90 = east, 90 = west).
     *
     * The one field here that stays JSONB, because it is the one field that is a
     * LIST. It does not reintroduce the clobber the placement test was written
     * for: that bug was two *different* settings pages writing two halves of one
     * JSONB document, and the array is written by exactly one form.
     *
     * WHY THE ELEMENT CARRIES ITS OWN PHYSICS
     *
     * `temp_coefficient` and `system_loss` below are the plant-wide DEFAULTS, and
     * an element may override either. They had to be overridable somewhere,
     * because neither is a property of a site: a temperature coefficient of Pmax
     * is a MODULE datasheet number, and system losses are per-string (soiling,
     * shading, mismatch, DC wiring) plus per-device (inverter conversion). A
     * plant with a shaded east string and a clean south one has no single honest
     * value, which is why `../../../apps/server/src/forecast/forecast-correction.ts`
     * exists to learn the residual. `pvPowerW` already took both per array; only
     * the storage collapsed them.
     *
     * `deviceSlug` records which device a string feeds. Nothing consumes it yet,
     * and there is a test asserting it moves no number — the point is that it is
     * RECORDABLE now, because per-device forecast, per-device clipping and
     * per-device yield attribution are all unexpressible without it.
     *
     * WHY THIS IS STILL JSONB AND `plant_arrays` IS DEFERRED
     *
     * A real table is defensible and the deferral is deliberate, not an oversight.
     * The test 2.0.0 applied to every candidate change was: does the window close
     * with this release? It closes for anything that re-keys `metrics_raw`, and
     * for `metric_keys.unit`, whose value is unrecoverable once the profile that
     * stated it is uninstalled. It does NOT close here — no reading is keyed by an
     * array, so extracting `plant_arrays` later is a plain additive migration with
     * no relation to rewrite and no history to re-point.
     *
     * What could NOT wait was the element SHAPE: adding these three optional
     * fields to a JSONB document costs nothing today and would cost a migration
     * after the extraction. So the shape landed now and the table did not — and
     * once the elements carry `deviceSlug`, the extraction is mechanical.
     */
    arrays: jsonb("arrays").notNull().default([]),
    /** Power temperature coefficient of Pmax, %/°C (negative). */
    tempCoefficient: doublePrecision("temp_coefficient").notNull().default(-0.4),
    /** Static system losses, % (inverter, wiring, soiling, mismatch). */
    systemLoss: doublePrecision("system_loss").notNull().default(14),
    /** Feed-in cap in W ("solar sell" limit), or null to model no export limit. */
    maxOutputW: doublePrecision("max_output_w"),
    /** Average house load in W for the clipping model; null = infer from history. */
    houseLoadW: doublePrecision("house_load_w"),
    /**
     * Date a smart-meter gateway (iMSys) was installed, `YYYY-MM-DD`, or null.
     *
     * A plant fact, not an automation knob: installing one lifts the 60 %
     * Wirkleistungsbegrenzung to 100 % and marks the plant as belonging to the
     * cohort §51 EEG applies to, which is what price-aware automation is gated on.
     */
    smartMeterSince: text("smart_meter_since"),

    /**
     * Bidding zone (market area) the plant settles in, e.g. `DE-LU` — the
     * spot-price feed's reference.
     */
    biddingZone: text("bidding_zone"),
    /**
     * `app_settings.key` holding this plant's tariff, or null for the instance
     * default (`"tariff"`).
     *
     * A soft reference on purpose: tariffs are still validated JSONB documents
     * with a per-key Zod schema, and turning them into a table is a separate
     * change. Naming the key here is what makes a second plant possible without
     * one — which is the whole reason this is a table.
     */
    tariffKey: text("tariff_key"),

    createdAt: createdAtTz(),
  },
  (t) => [
    /**
     * The power temperature coefficient of Pmax is not positive.
     *
     * A panel LOSES power as it heats, so this value is negative by definition. A
     * positive one silently inverts the derate: the forecast then predicts MORE
     * power on the hottest afternoon of the year, and the peak-shaving plan built
     * on that forecast under-charges the battery before the evening peak. Nothing
     * errors — the model just reads backwards.
     *
     * `<= 0`, not `< 0`, because `../weather.ts` validates
     * `z.number().min(-2).max(0)` and a plant saved through the settings page may
     * legitimately carry 0 ("model no temperature derate"). The check mirrors the
     * edge; the `-2` floor is deliberately NOT mirrored, so an imported archive
     * with an unusual-but-signed coefficient still restores.
     */
    check("plants_temp_coefficient_check", sql`${t.tempCoefficient} <= 0`),
  ],
);

export type PlantRow = typeof plants.$inferSelect;
export type PlantInsert = typeof plants.$inferInsert;

/**
 * An int2 surrogate primary key, `GENERATED ALWAYS AS IDENTITY`.
 *
 * `ALWAYS`, not `BY DEFAULT`: nothing may assign one. These ids are written into
 * every reading, so an id supplied by hand — a restore script, a fixture, a
 * well-meant `INSERT` carrying the old row's number — could rebind years of
 * history to a different device. int2 also caps the sequence at 32767, which is
 * the ceiling the whole design is sized against.
 */
const identityKey = () => smallint("id").generatedAlwaysAsIdentity().primaryKey();

/**
 * A required reference to the plant, `ON DELETE RESTRICT`.
 *
 * A factory, so the two tables that own one cannot drift apart on the delete
 * rule — a `CASCADE` here would let deleting a plant take its devices, and with
 * them the meaning of every reading those devices wrote.
 */
const plantRef = () =>
  smallint("plant_id")
    .notNull()
    .references(() => plants.id, { onDelete: "restrict" });

/**
 * A Modbus ENDPOINT. **Not a device.**
 *
 * This distinction is the entire reason the table exists:
 *
 *  - Victron multiplexes many logical devices behind one GX endpoint by unit id,
 *    each with its own VRM instance;
 *  - Sigenergy puts a plant controller and its inverters on separate unit ids
 *    behind one connection;
 *  - Deye is the degenerate case — one device on one connection.
 *
 * So `(host, port)` can never be a device key, and editing a gateway's port must
 * touch ONE row rather than N. The old `app_settings.inverter` record conflated
 * the two: it held `host`, `port`, `transport`, `unitId` and `pollIntervalMs`
 * together, which is exactly a one-device-per-endpoint assumption written down.
 */
export const connections = pgTable(
  "connections",
  {
    id: identityKey(),
    plantId: plantRef(),
    /** Label for the endpoint ("GX gateway", "RS485 bridge"). */
    name: text("name").notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull().default(502),
    /** `tcp`, or `rtu-over-tcp` (RTU frames tunneled over TCP). */
    transport: text("transport").notNull().default("tcp"),
    /** Per-request Modbus timeout, ms. */
    timeoutMs: integer("timeout_ms").notNull().default(2000),
    /** Poll cadence for this endpoint, ms. Floored at 1000 by the runtime. */
    pollIntervalMs: integer("poll_interval_ms").notNull().default(1000),
    createdAt: createdAtTz(),
  },
  (t) => [
    /**
     * The framing modes the Modbus client actually implements.
     *
     * Mirrors `../inverter-config.ts`'s `z.enum(["tcp", "rtu-over-tcp"])` exactly.
     * A third value is not a validation nicety: the client has no branch for it,
     * so the endpoint simply never polls, and the plant goes quiet with no error
     * anyone reads.
     */
    check("connections_transport_check", sql`${t.transport} in ('tcp', 'rtu-over-tcp')`),
  ],
);

export type ConnectionRow = typeof connections.$inferSelect;
export type ConnectionInsert = typeof connections.$inferInsert;

/**
 * A device — the thing a reading is FROM, and the int2 written into every row of
 * `metrics_raw`.
 *
 * `id` is the identity, and it is a surrogate for two hard reasons:
 *
 *  - `serial` is not available everywhere. Not every vendor exposes one, so
 *    anchoring on it makes the fallback path the common path and turns
 *    uniqueness into a conditional. It is recorded where offered (a VRM
 *    instance, a nameplate serial) and is never the key.
 *  - `profile_id` is a profile, and profiles are swapped. There is deliberately
 *    NO foreign key to `installed_profiles`: a profile can be uninstalled while
 *    raw retention is five years, and the previous schema's answer to that —
 *    keying history by the profile id — is the bug being fixed. The device
 *    outlives the profile that describes how to talk to it.
 *
 * CONTROLLERS AND GATEWAYS ARE DEVICES. Sigenergy's plant controller and
 * Victron's GX have their own registers — plant SOC, total power, setpoints —
 * and those readings are written to `metrics_raw` under their own `device_id`
 * with `role = 'controller'`. So a plant-level value is READ FROM A DEVICE, and
 * the read layer must never assume a plant total is the sum of the plant's
 * `role = 'inverter'` rows. Summing them where a controller reports the total
 * double-counts; summing them where no controller exists is the only way to get
 * one. The role is what tells those apart.
 */
export const devices = pgTable(
  "devices",
  {
    id: identityKey(),
    plantId: plantRef(),
    /**
     * The endpoint this device is reached through, or null for a device with no
     * endpoint at all (`INVERTER_SIMULATE`, and an imported history whose
     * hardware is gone). Postgres treats NULLs as distinct in a unique index,
     * so any number of endpoint-less devices coexist.
     */
    connectionId: smallint("connection_id").references(() => connections.id, {
      onDelete: "restrict",
    }),
    /** The Modbus slave id behind {@link connectionId}. Many devices per endpoint. */
    unitId: smallint("unit_id").notNull(),
    /**
     * Stable machine name — THE API AND EXPORT VOCABULARY.
     *
     * Every route, MQTT topic, CSV column and saved chart names a device by
     * `slug`, never by the int2: the integer is a storage detail chosen for
     * bytes on the write path, and putting it in a URL would make a database
     * restore or a re-add renumber the API.
     */
    slug: text("slug").notNull(),
    /** User-facing label. Editable, unlike the slug. */
    name: text("name").notNull(),
    /** `ProfileData.id` describing how to talk to this device. No FK — see above. */
    profileId: text("profile_id").notNull(),
    /** Vendor identity where offered (VRM instance, nameplate serial). Never the key. */
    serial: text("serial"),
    /** `inverter` | `controller` | `meter` | `charger`. */
    role: text("role").notNull(),
    /**
     * When this device was taken out of service, or null while it is in service.
     *
     * THE LIFECYCLE FLAG `ON DELETE RESTRICT` MAKES NECESSARY.
     *
     * `metrics_raw.device_id` references this table `ON DELETE RESTRICT`, and
     * that is correct: the readings are the point, and deleting the device would
     * destroy the meaning of every row it ever wrote. The consequence is that a
     * device with history can NEVER be deleted — so without this column there is
     * no way to take one out of service at all. A replaced inverter would go on
     * being polled forever (a connection that times out on every cycle), or the
     * row would be worked around by editing its endpoint to something dead,
     * which loses the fact that it was retired.
     *
     * SEMANTICS, and the third one is the load-bearing one:
     *
     *  1. A retired device is not polled.
     *  2. Its history is RETAINED and stays readable. Nothing is hidden: the
     *     rows are still in `metrics_raw`, still in the aggregates, still
     *     exported. Retirement is about the future, not the past.
     *  3. It must never be re-ADOPTED. Provisioning matches an existing device
     *     by slug and by `(connection, unit)`, and those uniques are
     *     unconditional on purpose — a retired device's slug is written into
     *     years of exports and saved charts, so re-using it would make two
     *     machines share one name. That means `ensureDevice` on a retired slug
     *     hands back the RETIRED row, and a boot that ignored this column would
     *     resurrect it. Callers filter on it (`../plant-repo.ts`'s
     *     `activeDevices` / `readDevices({ includeRetired: false })`) rather
     *     than assuming what they got back is pollable.
     *
     * A TIMESTAMP rather than a boolean, and nullable rather than defaulted: the
     * date is the only record of WHEN the machine left the plant, which is what
     * makes a gap in the history explicable a year later — and null keeps "in
     * service" distinguishable from "retired at an unknown time".
     */
    retiredAt: retiredAtTz(),
    createdAt: createdAtTz(),
  },
  (t) => [
    // The API vocabulary must be unambiguous within a plant.
    unique("devices_plant_slug_key").on(t.plantId, t.slug),
    // One device per (endpoint, slave id): the physical addressing constraint.
    // A unique CONSTRAINT would treat two endpoint-less devices as colliding on
    // (NULL, 1) in some engines; an index is explicit that NULLs are distinct.
    uniqueIndex("devices_connection_unit_key").on(t.connectionId, t.unitId),
    index("devices_plant_role_idx").on(t.plantId, t.role),
    /**
     * The four roles the read layer branches on.
     *
     * The role is what tells "this device REPORTS the plant total" from "this
     * device is one of the inverters the total is summed FROM" — see the note
     * above on controllers. A fifth value falls through both arms: the rows are
     * counted in neither, so a plant quietly loses a device's contribution
     * instead of failing. Only `'inverter'` is written today (provisioning, the
     * archive import, the 1.2.0 upgrade); the other three are modelled and are
     * what a Victron GX or a Sigenergy controller will be written as.
     */
    check("devices_role_check", sql`${t.role} in ('inverter', 'controller', 'meter', 'charger')`),
  ],
);

export type DeviceRow = typeof devices.$inferSelect;
export type DeviceInsert = typeof devices.$inferInsert;

/**
 * A battery pack, owned by the device that reports it.
 *
 * Its own table rather than nullable columns on `devices` for two reasons: a
 * meter, a charger and a controller have no pack at all, and a shared HV stack
 * across two inverters then becomes an ADDITIVE change — drop the unique, add an
 * owning column — instead of another re-key.
 *
 * The plant-level battery the forecast and the automation engine read is DERIVED
 * from these rows (`../batteries.ts`): capacities sum, and `minSoc` is a
 * fraction, so it must be capacity-weighted rather than averaged.
 */
export const batteries = pgTable(
  "batteries",
  {
    id: identityKey(),
    /** One pack per device, for now. Dropping this unique is how a shared stack arrives. */
    deviceId: smallint("device_id")
      .notNull()
      .unique()
      .references(() => devices.id, { onDelete: "restrict" }),
    /** Usable (not nominal) energy in kWh — the DoD-limited window. */
    usableKwh: doublePrecision("usable_kwh").notNull(),
    /** Max charge power in W, or null for "unbounded within the hour". */
    maxChargeW: doublePrecision("max_charge_w"),
    /** Reserve floor in % the pack is not discharged below. */
    minSoc: doublePrecision("min_soc").notNull().default(10),
    /**
     * Nominal pack voltage in V — what the peak-shaving engine converts watts to
     * charge-current amps with when no `battery.voltage` metric is mapped.
     *
     * Nullable so "never stated" stays distinguishable from "stated as 51.2". This
     * value has now moved TWICE (automations config → `weather.forecast.battery` →
     * here), and each move needed the same care: an install that set 48 V on the
     * automations page must not silently start being driven at a default. See
     * `../batteries.ts`'s `resolveNominalV` for the fallback chain that carries
     * both legacy locations forward.
     */
    nominalV: doublePrecision("nominal_v"),
    createdAt: createdAtTz(),
  },
  (t) => [
    /**
     * The reserve floor is a percentage of the pack.
     *
     * `../batteries.ts` weights it by capacity to derive the plant reserve. Above
     * 100 the reserved energy exceeds the pack, so the usable window computes
     * NEGATIVE and the engine discharges nothing; below 0 it discharges past the
     * DoD limit the `usable_kwh` figure already accounts for. Mirrors
     * `../weather.ts`'s `z.number().min(0).max(100)`, and the boundaries are
     * inclusive there too — 0 (drain fully) and 100 (never discharge) are both
     * legitimate settings.
     */
    check("batteries_min_soc_check", sql`${t.minSoc} between 0 and 100`),
  ],
);

export type BatteryRow = typeof batteries.$inferSelect;
export type BatteryInsert = typeof batteries.$inferInsert;

/**
 * The metric vocabulary, GLOBAL rather than per-device.
 *
 * Global because a metric key means the same thing on every device — `pv.power`
 * is `pv.power` — and because per-device keys would multiply the dimension by
 * the device count for no gain, against an int2 ceiling of 32767.
 *
 * That ceiling is ample (~108 metrics per profile) on ONE condition: ids are
 * never churned. A profile reinstall must reuse existing rows rather than
 * renumber, which is what `../metric-keys.ts` enforces and
 * `apps/server/db-tests/baseline.test.ts` proves.
 *
 * `is_counter` is here rather than derived from the profile because the
 * aggregates need it: `counter_agg` belongs on monotonic counters, and a
 * continuous aggregate cannot ask another table what a row's class is. It is the
 * one metric fact the read layer needs while the profile that declared it may
 * already be uninstalled.
 */
export const metricKeys = pgTable("metric_keys", {
  id: identityKey(),
  key: text("key").notNull().unique(),
  /**
   * Whether this metric is a monotonically increasing counter (an energy total),
   * as opposed to an instantaneous reading.
   *
   * Defaults to false: the writer's upsert fallback registers a key it has never
   * seen from a profile downloaded at runtime, and "not a counter" is the
   * answer that cannot corrupt a delta.
   */
  isCounter: boolean("is_counter").notNull().default(false),
  /**
   * Display unit as the profile stated it (`W`, `kWh`, `%`, `V`), or null when
   * no profile ever stated one.
   *
   * Here for the same reason `is_counter` is, and with more at stake. That
   * column was promoted out of the profile because the aggregates need it while
   * the profile that declared it may already be uninstalled. The unit has the
   * identical property — exports, CSV headers, chart axes and the
   * counter-to-energy conversion all need it — with one difference that decides
   * the design: `is_counter` guessed wrong is a wrong delta on a live metric,
   * visible and fixable, whereas a unit lost with an uninstalled profile is
   * UNRECOVERABLE. Nothing in five years of `metrics_raw` records whether a
   * column of numbers was watts or kilowatts. Adding the column later is cheap;
   * recovering the units is impossible, so it is added now.
   *
   * NULLABLE, and deliberately NOT defaulted to `''`: "never stated" and
   * "stated as empty" are different facts. A dimensionless metric (a count, a
   * ratio, a status code) legitimately states `""`, and a reader that cannot
   * tell that from an unregistered key would render a unit it invented. The
   * upsert in `../metric-keys.ts` preserves the distinction by only overwriting
   * with a non-null incoming value.
   */
  unit: text("unit"),
});

export type MetricKeyRow = typeof metricKeys.$inferSelect;
export type MetricKeyInsert = typeof metricKeys.$inferInsert;
