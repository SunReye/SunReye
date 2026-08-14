/**
 * Admin API-key management.
 *
 * The `@better-auth/api-key` plugin's client endpoints are key-owner-scoped (a
 * user only ever sees/creates/deletes their own keys). To let an admin manage
 * keys for *any* user, these helpers back the admin-guarded `/api/admin/api-keys`
 * routes in `index.ts`:
 *
 * - Create goes through `auth.api.createApiKey`, which accepts a `userId` in the
 *   body only when invoked without a request context — i.e. a direct server call
 *   with `{ body }` and no `headers`. That is exactly what we do here; the admin
 *   check happens at the route via the `requireAdmin` macro.
 * - List and revoke are plain DB operations on the `apikey` table, since the
 *   plugin exposes no cross-user variants. Listing never returns the hashed key.
 */

import { auth } from "@SunReye/auth";
import { db } from "@SunReye/db";
import { apikey, user } from "@SunReye/db/schema/auth";
import { desc, eq } from "drizzle-orm";

/** List keys (optionally for one user), joined to their owner. Never exposes the key hash. */
export async function listApiKeys(userId?: string) {
  const base = db
    .select({
      id: apikey.id,
      name: apikey.name,
      prefix: apikey.prefix,
      start: apikey.start,
      enabled: apikey.enabled,
      expiresAt: apikey.expiresAt,
      lastRequest: apikey.lastRequest,
      createdAt: apikey.createdAt,
      userId: apikey.referenceId,
      userEmail: user.email,
      userName: user.name,
    })
    .from(apikey)
    .innerJoin(user, eq(apikey.referenceId, user.id));

  const filtered = userId ? base.where(eq(apikey.referenceId, userId)) : base;
  return filtered.orderBy(desc(apikey.createdAt));
}

/**
 * Create a key for `userId`. Returns the plaintext `key` — the only time it is
 * ever visible. `expiresIn` is in seconds.
 */
export async function createApiKeyForUser(input: {
  userId: string;
  name: string;
  expiresIn?: number | null;
}) {
  return auth.api.createApiKey({
    body: {
      userId: input.userId,
      name: input.name,
      expiresIn: input.expiresIn ?? null,
    },
  });
}

/** Hard-delete a key by id. Admin-only; ownership is not checked (admin manages all). */
export async function revokeApiKey(id: string) {
  await db.delete(apikey).where(eq(apikey.id, id));
  return { success: true } as const;
}
