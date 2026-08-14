import { Elysia, t } from "elysia";
import { createApiKeyForUser, listApiKeys, revokeApiKey } from "../admin/api-keys";
import { log } from "../shared/logging";
import { RESET_DATA_CONFIRM, resetTimeseries } from "../admin/maintenance";
import * as runtime from "../inverter/runtime";
import { adminGuard } from "./admin-guard";

const adminLog = log();

/**
 * Exit code signalling "restart me" to whatever supervises the process. The dev
 * runner (`bun run --watch` inside a restart loop) relaunches only on this code
 * — Ctrl-C exits 0 and a crash exits non-zero, so neither loops — and the prod
 * container's `restart: unless-stopped` policy relaunches on any exit.
 *
 * In the HA addon, s6 supervises this process: `svc-server/finish` treats 75 as
 * a respawn of this service alone, and every *other* non-zero code as a death
 * that halts the container. Keep the two distinguishable — collapsing them
 * turns each profile activation into a full addon bounce.
 */
const RESTART_EXIT_CODE = 75;

// Admin-only maintenance surface: destructive data reset + API-key management.
export const adminRoutes = new Elysia({ name: "admin-routes" })
  .use(adminGuard)
  // DANGER: wipe every recorded measurement (raw hypertable + rollups) so the
  // instance starts fresh. Accounts, settings, tariff, and profiles survive —
  // only time-series data is dropped, and there is no undo. The caller must echo
  // back the exact confirmation phrase so an accidental/replayed request can't
  // nuke the history.
  .post(
    "/api/admin/reset-data",
    async ({ body, status }) => {
      if (body.confirm !== RESET_DATA_CONFIRM) {
        return status(400, { error: "Confirmation phrase does not match" });
      }
      const result = await resetTimeseries();
      adminLog.warn("time-series data wiped via admin reset: {cleared}", {
        cleared: result.cleared.join(", "),
      });
      return { ok: true, ...result };
    },
    { requireAdmin: true, body: t.Object({ confirm: t.String() }) },
  )
  // API-key administration. Admin-only surface for issuing/listing/revoking
  // keys on behalf of any user (see ../api-keys). The generated key is returned
  // exactly once, on create.
  .get("/api/admin/api-keys", ({ query }) => listApiKeys(query.userId), {
    requireAdmin: true,
    query: t.Object({ userId: t.Optional(t.String()) }),
  })
  .post("/api/admin/api-keys", ({ body }) => createApiKeyForUser(body), {
    requireAdmin: true,
    body: t.Object({
      userId: t.String(),
      name: t.String({ minLength: 1 }),
      expiresIn: t.Optional(t.Nullable(t.Number({ minimum: 1 }))),
    }),
  })
  .post("/api/admin/api-keys/revoke", ({ body }) => revokeApiKey(body.id), {
    requireAdmin: true,
    body: t.Object({ id: t.String() }),
  })
  // Restart the process so a boot-time change (chiefly a newly activated inverter
  // profile, which reshapes the routes/manifest/topics built once at boot) takes
  // effect. Responds first, then releases the runtime and exits with the restart
  // sentinel for the supervisor to relaunch. The client polls until the server
  // answers again, then reloads.
  .post(
    "/api/admin/restart",
    () => {
      adminLog.warn("server restart requested via admin API — exiting for supervised relaunch");
      // Defer past the response flush, then shut down gracefully and exit.
      setTimeout(async () => {
        await runtime.stop();
        process.exit(RESTART_EXIT_CODE);
      }, 150);
      return { ok: true };
    },
    { requireAdmin: true },
  );
