/**
 * How a database row becomes the API-key shape the dashboard receives.
 *
 * Kept free of the db and auth modules so it can be tested without an
 * environment: importing those pulls in Better Auth's context, which needs env.
 * The shape itself lives in `@SunReye/contracts/api-keys`, so the dashboard
 * reads the same declaration rather than its own copy.
 */
import type { ApiKeyView } from "@SunReye/contracts/api-keys";

/**
 * Render one row for the response.
 *
 * JSON has no Date, so a `Date` column reaches the browser as a string no
 * matter what the handler's return type says. Under Elysia 1 Eden inferred the
 * serialized shape and agreed with the dashboard by accident; Eden 2 propagates
 * the declared `Date` instead, and the two stopped matching. Converting here
 * makes the declared type the wire type, so neither side has to guess.
 */
export function serializeApiKey(row: {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  enabled: boolean;
  expiresAt: Date | null;
  lastRequest: Date | null;
  createdAt: Date;
  userId: string;
  userEmail: string;
  userName: string;
}): ApiKeyView {
  return {
    ...row,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastRequest: row.lastRequest?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
