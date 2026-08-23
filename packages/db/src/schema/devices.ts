import { boolean, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { createdAtTz, updatedAtTz } from "./columns";

/**
 * A connection: one host, one set of credentials, one health state.
 *
 * Split from {@link devices} because a source is not a device. One EVCC
 * publishes N loadpoints, one Home Assistant exposes a whole house, and several
 * inverters on one RS485→Ethernet gateway share a host and differ only by unit
 * id. Collapsing the two is what made "the active profile" a single global.
 */
export const sources = pgTable("sources", {
  /** Stable slug, e.g. `default` for the connection an existing install has. */
  id: text("id").primaryKey(),
  /** Which integration speaks to it: `modbus`, `http`, `simulator`, … */
  kind: text("kind").notNull(),
  /** What to call it in the UI. */
  label: text("label").notNull(),
  /**
   * The connection itself — host, port, framing, timeouts, poll cadence — as an
   * opaque blob, validated per `kind` by a Zod schema at the edge exactly as
   * `app_settings` values are. Shapeless here because a Modbus host and an HTTP
   * base URL have nothing in common but the fact that something dials them.
   */
  config: jsonb("config").notNull(),
  /** A source switched off polls nothing and keeps every row it ever wrote. */
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: createdAtTz(),
  updatedAt: updatedAtTz(),
});

export type SourceRow = typeof sources.$inferSelect;
export type SourceInsert = typeof sources.$inferInsert;

/**
 * One device reached through a {@link sources} row: the thing that has metrics,
 * a profile that decodes them, and an id that every reading is written under.
 *
 * `id` is text and is deliberately not generated. The first device of an
 * existing install inherits the active profile's id, because that exact string
 * is already the `inverter_id` of every row in `metrics_raw` — a column that is
 * a physical compression segment key — and the `sunreye_<id>` prefix of every
 * Home Assistant entity the MQTT bridge has ever registered. A fresh uuid would
 * silently split the history and re-create every HA entity under new ids.
 */
export const devices = pgTable(
  "devices",
  {
    /** Written into `metrics_raw.inverter_id`; never reassigned. */
    id: text("id").primaryKey(),
    /**
     * The connection this device is reached through. `restrict`, not `cascade`:
     * a device's readings outlive it and are addressed by its id, and
     * `metrics_raw` has no foreign key to clean up after. Deleting a source out
     * from under its devices has to be a deliberate, visible act.
     */
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    /**
     * The profile that decodes this device. Plain text rather than a reference
     * to `installed_profiles`: built-in profiles are registered in-process and
     * have no row there, exactly as they have none today.
     */
    profileId: text("profile_id").notNull(),
    /** `inverter`, `meter`, `battery`, `loadpoint`, … */
    deviceClass: text("device_class").notNull(),
    label: text("label").notNull(),
    /**
     * How to pick this device out of the ones sharing its connection: a Modbus
     * unit id, an EVCC loadpoint index, an entity prefix. The source's `kind`
     * decides what the shape means, so it is opaque here.
     */
    address: jsonb("address").notNull(),
    /** Disabled devices are not polled and keep everything they ever wrote. */
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: createdAtTz(),
    updatedAt: updatedAtTz(),
  },
  (table) => [index("devices_source_id_idx").on(table.sourceId)],
);

export type DeviceRow = typeof devices.$inferSelect;
export type DeviceInsert = typeof devices.$inferInsert;
