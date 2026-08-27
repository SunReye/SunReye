import { env } from "@SunReye/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

export function createDb() {
  return createDbAt(env.DATABASE_URL);
}

/**
 * A client for an explicitly named database, rather than the one the
 * environment points at.
 *
 * Exists for the database-backed test layer (`apps/server/db-tests`), which must
 * connect to its own scratch database and must never reach the configured one —
 * that database is shared with a live inverter. Keeping the driver choice here
 * also means callers need no direct `pg` dependency.
 */
export function createDbAt(databaseUrl: string) {
  return drizzle(databaseUrl, { schema });
}

export const db = createDb();
