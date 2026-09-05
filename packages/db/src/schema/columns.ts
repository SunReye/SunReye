import { timestamp } from "drizzle-orm/pg-core";

/**
 * Shared column builders for the recurring `created_at` / `updated_at`
 * bookkeeping columns.
 *
 * Each helper is a **factory** that returns a fresh builder, so spreading one
 * into a table is exactly equivalent to writing the column out inline — the
 * emitted DDL is byte-identical. Purely an organisational move: changing any of
 * these changes the schema, so treat an edit here as a migration.
 *
 * Two flavours, and they are not interchangeable:
 * - plain `timestamp` — Better Auth's tables (`auth.ts`), whose committed
 *   migrations declare the columns without a time zone.
 * - `timestamptz` (`…Tz`) — every table this app owns.
 */

/** Refresh `updated_at` on write; shared by both flavours. */
const onWrite = () => /* @__PURE__ */ new Date();

/** `created_at`, stamped once on insert. Timezone-naive (Better Auth). */
export const createdAt = () => timestamp("created_at").defaultNow().notNull();

/** `updated_at`, defaulted on insert and refreshed on every update. Timezone-naive. */
const updatedAt = () => timestamp("updated_at").defaultNow().$onUpdate(onWrite).notNull();

/** The timezone-naive `created_at` + `updated_at` pair, spread into a table. */
export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });

/** `created_at` as `timestamptz`, stamped once on insert. */
export const createdAtTz = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/** `updated_at` as `timestamptz`, defaulted on insert and refreshed on every update. */
export const updatedAtTz = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(onWrite).notNull();
