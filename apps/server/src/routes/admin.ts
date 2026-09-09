import { Elysia, t } from "elysia";
import { createApiKeyForUser, listApiKeys, revokeApiKey } from "../admin/api-keys";
import { log } from "../shared/logging";
import { RESET_DATA_CONFIRM, resetTimeseries } from "../admin/maintenance";
import { buildExportArchive } from "../admin/archive-download";
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
    { requireAdmin: true, body: t.Object({ confirm: t.String() }) },
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
  )
  // TAKE A COPY BEFORE YOU DELETE ONE. The counterpart to `reset-data` above, and
  // it lives beside it on purpose: "delete every measurement" without "download
  // everything first" is a button nobody should be asked to press.
  //
  // A GET, not a POST, and that is what makes it a download at all: the browser
  // has to be able to follow it as a navigation so it streams to disk instead of
  // through a Blob in memory. It is still admin-only (`requireAdmin`), and it
  // takes NO parameters — there is nothing here for a crafted link to steer.
  //
  // The response body is a `Bun.file`, which the runtime streams: a full export
  // is ~9 M readings and 53 MB measured on the real fixture, and neither this
  // process nor the browser should hold that. `Content-Length` is real because
  // the archive is finished before the first byte goes out (a tar header must
  // declare its member sizes — see packages/db/src/archive-file.ts), which also
  // means the download shows a progress bar and can be resumed.
  .get("/api/admin/export", { requireAdmin: true }, async ({ set }) => {
    const archive = await buildExportArchive();
    adminLog.info("archive export downloaded: {filename} ({bytes} bytes, {rows} readings)", {
      filename: archive.filename,
      bytes: archive.bytes,
      rows: archive.rows,
    });
    set.headers["content-type"] = "application/gzip";
    set.headers["content-disposition"] = `attachment; filename="${archive.filename}"`;
    set.headers["content-length"] = String(archive.bytes);
    // No caching: the next export is a different file with the same route.
    set.headers["cache-control"] = "no-store";
    return Bun.file(archive.path);
  })
  // API-key administration. Admin-only surface for issuing/listing/revoking
  // keys on behalf of any user (see ../api-keys). The generated key is returned
  // exactly once, on create.
  .get(
    "/api/admin/api-keys",
    {
      requireAdmin: true,
      query: t.Object({ userId: t.Optional(t.String()) }),
    },
    ({ query }) => listApiKeys(query.userId),
  )
  .post(
    "/api/admin/api-keys",
    {
      requireAdmin: true,
      body: t.Object({
        userId: t.String(),
        name: t.String({ minLength: 1 }),
        expiresIn: t.Optional(t.Nullable(t.Number({ minimum: 1 }))),
      }),
    },
    ({ body }) => createApiKeyForUser(body),
  )
  .post(
    "/api/admin/api-keys/revoke",
    {
      requireAdmin: true,
      body: t.Object({ id: t.String() }),
    },
    ({ body }) => revokeApiKey(body.id),
  )
  // Restart the process so a boot-time change (chiefly a newly activated inverter
  // profile, which reshapes the routes/manifest/topics built once at boot) takes
  // effect. Responds first, then releases the runtime and exits with the restart
  // sentinel for the supervisor to relaunch. The client polls until the server
  // answers again, then reloads.
  .post("/api/admin/restart", { requireAdmin: true }, () => {
    adminLog.warn("server restart requested via admin API — exiting for supervised relaunch");
    // Defer past the response flush, then shut down gracefully and exit.
    setTimeout(async () => {
      await runtime.stop();
      process.exit(RESTART_EXIT_CODE);
    }, 150);
    return { ok: true };
  });
