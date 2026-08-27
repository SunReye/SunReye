/**
 * Reading the migration record out of `app_settings`.
 *
 * Its own module, small, because THREE unrelated callers need it and none of them
 * is its natural owner: the boot chain (to decide whether to hold discovery), the
 * read guard (`../shared/history-horizon.ts`, to refuse partial windows), and the
 * onboarding surface (to pre-fill and to show the banner). A copy in each would be
 * three chances to disagree about what "no migration" looks like — on the document
 * that decides whether an instance's only copy of two months of history may be
 * dropped.
 *
 * `app_settings` is the one table that exists on both sides of the 1.2.0 -> 2.0.0
 * schema break, which is why the record lives there at all: the blocking step has
 * to write it before the 2.0.0 baseline has created anything.
 */

import { jsonDocument } from "@SunReye/db/json-value";
import {
  MIGRATION_KEY,
  type MigrationRecord,
  migrationRecordSchema,
  noMigration,
} from "@SunReye/db/upgrade-state";
import { db } from "@SunReye/db";
import { sql } from "drizzle-orm";

/**
 * One `app_settings` row, as any driver hands it back.
 *
 * An index signature as well as `value`, because `db.execute` constrains its row
 * type to `Record<string, unknown>` — a plain interface with one property does not
 * satisfy it.
 */
export interface SettingRow extends Record<string, unknown> {
  value: unknown;
}

/**
 * The record those rows describe — NEVER throwing, and never a partial object.
 *
 * Every degradation lands on {@link noMigration} ("this install never ran a 1.x
 * upgrade"), which is the safe direction and the overwhelmingly common truth. The
 * dangerous direction would be the other one: reporting a migration in progress
 * on a healthy install holds discovery and refuses history reads forever.
 *
 * The unwrap is load-bearing, not defensive. bun's `SQL` binds a JS string to a
 * `jsonb` column as a JSON *string* whose content is the document, and that is how
 * the record is written (`@SunReye/db/upgrade-120-run`'s `writeMigrationRecord`),
 * so the double-encoded form is the NORMAL one — see `@SunReye/db/json-value`.
 */
export function migrationRecordFrom(rows: readonly SettingRow[]): MigrationRecord {
  const raw = rows[0]?.value;
  if (raw === undefined || raw === null) return noMigration;
  const parsed = migrationRecordSchema.safeParse(jsonDocument(raw));
  return parsed.success ? parsed.data : noMigration;
}

/** The live record. Reads per call: it changes as the migration advances. */
export async function readMigrationRecord(): Promise<MigrationRecord> {
  const result = await db.execute<SettingRow>(
    sql`select value from app_settings where key = ${MIGRATION_KEY}`,
  );
  return migrationRecordFrom(result.rows as SettingRow[]);
}
