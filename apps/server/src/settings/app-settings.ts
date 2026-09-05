/**
 * Thin typed accessor over the `app_settings` key/value table. Each setting is
 * validated against its Zod schema on read (falling back to a default when the
 * row is missing or invalid) and upserted on write. Callers layer their own
 * in-memory cache on top (see settings.ts / config.ts).
 */

import { db } from "@SunReye/db";
import { appSettings } from "@SunReye/db/schema/settings";
import { eq } from "drizzle-orm";
import type { ZodError, ZodType } from "zod";
import { log } from "../shared/logging";
import { mergeSetting } from "./merge-setting";

const logger = log("settings");

/** Where the raw value of a rejected read is kept for `{@link key}`. */
// fallow-ignore-next-line unused-export -- asserted by app-settings.test.ts; test files aren't traced as consumers
export function rejectedKey(key: string): string {
  return `${key}:rejected`;
}

/**
 * Keys already warned about on this boot. A rejected row is a *standing*
 * condition, not an event: the poll loop and the API re-read the same settings
 * every few seconds, so warning per read would bury the log viewer's ring buffer
 * under one drifted row. Once per key per boot, and a restart says it again.
 */
const warnedKeys = new Set<string>();
/**
 * What is currently in each key's quarantine row, serialised — so a repeat read
 * of the same bad value is a no-op while a *different* bad value still replaces
 * it. Only recorded once the write landed, so a failed quarantine is retried.
 */
const quarantined = new Map<string, string>();

/** Zod issue paths + messages, flattened to something a log line can carry. */
function describeIssues(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Announce a row the schema rejected, and keep the raw value.
 *
 * The fallback itself stays — a half-parsed configuration must never reach a
 * register writer — but a silent fallback is how a shape drift wiped a user's
 * configuration once, and this table also holds the held-register snapshot: the
 * charge-current value an automation captured and still has to hand back.
 * Quarantining it under `<key>:rejected` makes that recoverable by hand.
 *
 * Best-effort: a quarantine that cannot be written must not turn a degraded read
 * into a failed boot.
 */
async function quarantineRejected(key: string, value: unknown, error: ZodError): Promise<void> {
  const issues = describeIssues(error);
  if (!warnedKeys.has(key)) {
    warnedKeys.add(key);
    logger.warn(
      "setting {key} failed validation and was replaced by its default; the stored value is kept under {quarantineKey} ({issues})",
      { key, quarantineKey: rejectedKey(key), issues },
    );
  }
  const serialised = JSON.stringify({ value }); // `undefined` never round-trips a jsonb column
  if (quarantined.get(key) === serialised) return;
  try {
    await writeSetting(rejectedKey(key), { value, issues, rejectedAt: new Date().toISOString() });
    quarantined.set(key, serialised);
  } catch (cause) {
    logger.warn("could not quarantine the rejected value of {key}: {error}", { key, error: cause });
  }
}

export async function readSetting<T>(key: string, schema: ZodType<T>, fallback: T): Promise<T> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (!row) return fallback;
  const parsed = schema.safeParse(row.value);
  if (parsed.success) return parsed.data;
  await quarantineRejected(key, row.value, parsed.error);
  return fallback;
}

export async function writeSetting<T>(key: string, value: T): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/** A single instance-wide setting: read (cached, validated) + validated write. */
export interface CachedSetting<T> {
  /** Active value, falling back to the default when unset/invalid. Cached. */
  get(): Promise<T>;
  /** Validate and persist (upsert), refreshing the cache. */
  set(input: unknown): Promise<T>;
  /**
   * Apply a PARTIAL update: merge onto the stored record, then validate and
   * persist as {@link set} does.
   *
   * For a record edited from more than one place. Two forms each sending the
   * whole record means the second save writes back whatever the first had
   * loaded, so one page silently undoes the other; sending only what a form owns
   * cannot. See ./merge-setting for what merges and what replaces.
   */
  patch(input: unknown): Promise<T>;
}

/**
 * Build a memory-cached accessor for one `app_settings` row (invalidated on
 * write). The shared shape behind display/access/weather/... so each is one
 * declaration rather than a copy of the same get/set pair.
 */
export function cachedSetting<T>(key: string, schema: ZodType<T>, fallback: T): CachedSetting<T> {
  let cache: T | null = null;
  const accessor: CachedSetting<T> = {
    async get() {
      cache ??= await readSetting(key, schema, fallback);
      return cache;
    },
    async set(input: unknown) {
      // Cache only once the row is safely written: a failed write must not
      // leave a value being served as the active setting that the database
      // never accepted (config.ts orders its own caches the same way).
      const value = schema.parse(input);
      await writeSetting(key, value);
      cache = value;
      return value;
    },
    async patch(input: unknown) {
      return accessor.set(mergeSetting(await accessor.get(), input));
    },
  };
  return accessor;
}
