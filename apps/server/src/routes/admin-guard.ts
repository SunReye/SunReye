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
