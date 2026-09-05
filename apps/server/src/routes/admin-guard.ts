import { auth } from "@SunReye/auth";
import { Elysia } from "elysia";
import { isPublicDashboard } from "../settings/access-settings";

/**
 * Whether a dashboard **read** may proceed. Allowed anonymously when the public
 * read-only dashboard is enabled (kiosk / wall-display mode); otherwise requires
 * any valid session (no role check).
 *
 * Module-private: it backed the `requireSession` macro below *and* the on-open
 * re-check of the five retired `/ws/*` routes. The live socket asks the same
 * question through `topicAccessFrom` instead, per subscribe frame rather than
 * once at upgrade, so the macro is the only caller left.
 */
async function dashboardReadAllowed(headers: Headers): Promise<boolean> {
  if (await isPublicDashboard()) return true;
  return (await auth.api.getSession({ headers })) !== null;
}

// Access gates. Opt in per route:
// - `requireAdmin` — privileged config reads + all mutations (config + live
//   inverter writes). Always needs an admin session; no dev bypass.
// - `requireSession` — dashboard reads. Needs any session, UNLESS the public
//   read-only dashboard is enabled, in which case anonymous reads are allowed.
// Named plugin: deduped when several route modules `.use()` it, and the macros
// propagate to every consumer.
//
// ## Where the gate sits in the lifecycle, and what that costs
//
// Both gates hang on `beforeHandle`, which in Elysia 2 runs AFTER the route's
// declared `body`/`query` schema is validated. Measured on 2.0.0-beta.7: an
// anonymous POST with a malformed body to a `requireAdmin` route is answered
// `422` naming the fields the route expects, and the guard is never consulted.
// So a stranger CAN make this server parse and validate a payload, and can read
// the shape of a request they are not allowed to make.
//
// It is not fixable from here. `transform` is documented as running before
// validation and as supporting an early return; on this version it does
// neither — a `status(401)` returned from a `transform` hook (global or via a
// macro) is ignored entirely and the request proceeds, which is worse than the
// 422. Both were tried and measured before this comment was written.
//
// What the ordering does NOT cost: the handler never runs, so no privileged
// read, write or inverter command is reachable. A well-formed anonymous request
// is refused 401/403 exactly as intended, and `apps/server/src/routes/admin-guard.test.ts`
// pins both halves so a future Elysia that reorders the lifecycle shows up as a
// failing test rather than as silence.
export const adminGuard = new Elysia({ name: "admin-guard" }).macro({
  requireAdmin(enabled: boolean) {
    if (!enabled) return {};
    return {
      async beforeHandle({ request, status }) {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return status(401, { error: "Authentication required" });
        if (session.user.role !== "admin") {
          return status(403, { error: "Admin access required" });
        }
      },
    };
  },
  requireSession(enabled: boolean) {
    if (!enabled) return {};
    return {
      async beforeHandle({ request, status }) {
        if (!(await dashboardReadAllowed(request.headers))) {
          return status(401, { error: "Authentication required" });
        }
      },
    };
  },
});
