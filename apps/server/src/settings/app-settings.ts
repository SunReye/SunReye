/**
 * Thin typed accessor over the `app_settings` key/value table. Each setting is
 * validated against its Zod schema on read (falling back to a default when the
 * row is missing or invalid) and upserted on write. Callers layer their own
 * in-memory cache on top (see settings.ts / config.ts).
 */

import { db } from "@SunReye/db";
import { appSettings } from "@SunReye/db/schema/settings";
import { eq } from "drizzle-orm";
import type { ZodType } from "zod";

export async function readSetting<T>(key: string, schema: ZodType<T>, fallback: T): Promise<T> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const parsed = row ? schema.safeParse(row.value) : null;
  return parsed?.success ? parsed.data : fallback;
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
}

/**
 * Build a memory-cached accessor for one `app_settings` row (invalidated on
 * write). The shared shape behind display/access/weather/... so each is one
 * declaration rather than a copy of the same get/set pair.
 */
export function cachedSetting<T>(key: string, schema: ZodType<T>, fallback: T): CachedSetting<T> {
  let cache: T | null = null;
  return {
    async get() {
      cache ??= await readSetting(key, schema, fallback);
      return cache;
    },
    async set(input) {
      cache = schema.parse(input);
      await writeSetting(key, cache);
      return cache;
    },
  };
}
