import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { updatedAtTz } from "./columns";

/**
 * Generic key/value application settings, stored as JSONB and validated by a
 * per-key Zod schema at the edge (see `@SunReye/db/tariff`). Keeps runtime
 * configuration (tariffs now; inverter/MQTT connection later) in the database
 * instead of env files, so it can be edited from the UI without a redeploy.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAtTz(),
});

export type AppSettingRow = typeof appSettings.$inferSelect;
export type AppSettingInsert = typeof appSettings.$inferInsert;

/**
 * Inverter profiles downloaded from a git repo source and installed into this
 * instance. `data` is the validated, serializable `ProfileData` (the source of
 * truth — the git clone cache is disposable). The server registers every row
 * into the profile registry at boot, so a restart is all it takes for a newly
 * downloaded profile to become selectable. See {@link @SunReye/db/profiles}.
 */
export const installedProfiles = pgTable("installed_profiles", {
  /** Profile id (`ProfileData.id`), e.g. `deye-sg05lp3`. */
  id: text("id").primaryKey(),
  /** Git repo URL this profile was downloaded from. */
  source: text("source").notNull(),
  /** `ProfileData.version` at install time (drives update detection). */
  version: text("version").notNull(),
  /** The full validated `ProfileData` blob. */
  data: jsonb("data").notNull(),
  installedAt: timestamp("installed_at", { withTimezone: true }).defaultNow().notNull(),
});

export type InstalledProfileRow = typeof installedProfiles.$inferSelect;
export type InstalledProfileInsert = typeof installedProfiles.$inferInsert;
