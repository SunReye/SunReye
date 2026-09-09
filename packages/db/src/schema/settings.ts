import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { updatedAtTz } from "./columns";

/**
 * Generic key/value application settings, stored as JSONB and validated by a
 * per-key Zod schema at the edge (see `@SunReye/db/tariff`). Keeps runtime
 * configuration in the database instead of env files, so it can be edited from
 * the UI without a redeploy.
 *
 * WHAT LEFT THIS TABLE IN 2.0.0, AND WHY
 *
 * The plant's own facts did — coordinates, PV arrays, the export cap, the
 * battery pack, the smart-meter date, the bidding zone — into columns on
 * `./plants.ts`. They had been scattered across the `weather`, `tariff` and
 * `spot-prices` keys HERE, and two settings pages writing two halves of one
 * JSONB document read-modify-wrote over each other so the loser's edit vanished
 * (`apps/web/src/lib/components/settings/plant-fields-placement.test.ts` exists
 * only because of that). With each fact a column an `UPDATE` touches only what
 * it names, so the whole bug class is gone rather than guarded.
 *
 * The rule that follows: a fact that DESCRIBES THE PLANT OR ITS HARDWARE belongs
 * in a column. What is left here is genuinely preference and policy — tariffs,
 * automation thresholds, MQTT credentials, UI defaults — documents that are read
 * whole, written whole, by one form each.
 *
 * DELIBERATELY NOT PLANT-SCOPED, AND THIS IS A DECISION
 *
 * `app_settings` and {@link installedProfiles} are keyed instance-wide, with no
 * `plant_id`. There is one plant today and no plan for a second; `plants` is a
 * table anyway because re-keying a hypertable is the expensive migration 2.0.0
 * spent its one clean break on, and nothing here is a hypertable. Adding a
 * `plant_id` to a settings row later is a purely ADDITIVE change — a nullable
 * column, a backfill of the one plant's id, a unique on `(plant_id, key)` — with
 * no relation to rewrite and no history to re-point.
 *
 * The seam that makes a second plant possible without it is already in place and
 * is worth copying rather than inventing: `plants.tariff_key` names the
 * `app_settings.key` holding that plant's tariff, defaulting to the instance-wide
 * one. A soft reference, per fact, added when a second plant actually arrives.
 *
 * PER-USER PREFERENCES ARE ALSO NOT SCOPED, FOR A DIFFERENT REASON
 *
 * `uiPrefs`, `display`, `statisticsPrefs` and `chartPalette` are instance-wide
 * even though `./auth.ts` has real users, so two operators share one theme and
 * one set of chart defaults. That is pre-existing 1.x behaviour and it is
 * unrelated to the identity break this release is for: it is a user-scoping
 * feature, not a schema defect, and shipping it inside a breaking migration
 * would mix a product change into a release whose changelog has to be about one
 * thing. Scoping them later means a `user_id` column and a per-user read, both
 * additive.
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
