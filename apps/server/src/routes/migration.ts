/**
 * THE MIGRATION ONBOARDING SURFACE over HTTP.
 *
 * Everything behind these four routes was built and tested before them
 * (`../migration/*`); this module is the seam and holds no rules of its own. Where
 * a rule looks like it is here, it is a translation: `planOnboarding`'s refusal
 * already carries its own status, and this file passes it through rather than
 * deciding again — two places deciding whether the MQTT identity is still editable
 * is exactly one place too many.
 *
 * ## The access policy, and why the status read is not admin-only
 *
 * `GET /api/migration/status` rides the DASHBOARD read policy (`requireSession`,
 * or anonymous when the public read-only dashboard is on), like
 * `/api/settings/display` and `/api/settings/chart-palette`. It has to: its whole
 * job is to say "the figures on this screen do not cover the window they claim",
 * and a kiosk is a screen. Hiding that from the wall display would leave the one
 * viewer who cannot ask anybody looking at incomplete numbers.
 *
 * Every WRITE is `requireAdmin`. Confirming the names releases a retained Home
 * Assistant announcement and freezes two permanent identifiers; starting the
 * backfill is three minutes of replay.
 */

import { Elysia, t } from "elysia";

import { createBackfillTask, runMigrationBackfill } from "../migration/backfill-task";
import { applyOnboarding, readMigrationView } from "../migration/onboarding-apply";
import { getMigrationNotice, setMigrationNotice } from "../settings/migration-notice-settings";
import { log } from "../shared/logging";
import { adminGuard } from "./admin-guard";

/** As much of the boot-time profile context as the backfill needs. */
export interface MigrationRoutesDeps {
  /** The active profile's manifest, or null on an onboarding-only boot. */
  manifest: { metrics: readonly { key: string; storage?: string }[] } | null;
}

/**
 * How long "remind me later" lasts.
 *
 * A week, and it is a snooze rather than a dismissal for the reason the banner
 * exists at all: a deferred migration that leaves the app looking complete never
 * gets run. Long enough to stop nagging somebody mid-task, short enough that two
 * months of absent history cannot be clicked away for good.
 */
const SNOOZE_DAYS = 7;

/**
 * The metric keys the profile classifies as CONFIGURATION.
 *
 * The profile's own answer (`resolveStorage`, already resolved into the manifest),
 * never a `settings.%` prefix match — that is one vendor's naming and stops
 * applying on the next. Getting it wrong does not fail: configuration registers
 * land in the hypertable instead of `metrics_config_log`, quietly restoring the
 * storage cost 2.0.0 exists to remove.
 */
function configKeysOf(deps: MigrationRoutesDeps): string[] {
  return (deps.manifest?.metrics ?? [])
    .filter((metric) => metric.storage === "config")
    .map((metric) => metric.key);
}

/** The body the onboarding form submits. Both names required; both slugs not. */
const namesBody = t.Object({
  plantName: t.String(),
  deviceName: t.String(),
  /** Present only when the operator edited the derived slug. */
  plantSlug: t.Optional(t.String()),
  deviceSlug: t.Optional(t.String()),
  migrateHistory: t.Union([t.Literal("now"), t.Literal("later")]),
});

export const migrationRoutes = (deps: MigrationRoutesDeps) => {
  // One task per process: the single-flight guard is the whole point, and a task
  // created per request would guard nothing. See ../migration/backfill-task.ts.
  const backfill = createBackfillTask({
    run: () => runMigrationBackfill(configKeysOf(deps)),
    onError: (error) =>
      log("migration").error("history backfill failed: {error}", {
        error: error instanceof Error ? error.message : String(error),
      }),
  });

  return (
    new Elysia({ name: "migration-routes" })
      .use(adminGuard)
      // What the app needs on every load: whether to show the onboarding form,
      // whether history is incomplete and from when, the names to pre-fill, and
      // whether the one-time slug window is still open.
      .get("/api/migration/status", { requireSession: true }, async () => ({
        ...(await readMigrationView()),
        backfillRunning: backfill.running(),
      }))
      // Confirm the two names — and, ONLY while discovery is still held, correct
      // the derived slugs. The refusal comes from ../migration/onboarding-plan.ts
      // with its own status: 409 when the window has closed (`slug_frozen`) or
      // there is nothing to confirm (`onboarding_closed`), 400 when a field is
      // wrong. Both names are reported at once; see validateNames.
      .post(
        "/api/migration/names",
        { requireAdmin: true, body: namesBody },
        async ({ body, status }) => {
          const result = await applyOnboarding(body);
          if (!result.ok) {
            return result.status === 409
              ? status(409, { error: result.error, message: result.message })
              : status(400, { error: result.error, errors: result.errors });
          }
          // "Now" starts the replay here rather than inside applyOnboarding: the
          // write path must be finished and committed before three minutes of
          // background work reads the record it just stamped.
          const started = result.migrateNow ? backfill.start() : null;
          return { ...result, backfill: started };
        },
      )
      // Run the deferred backfill. Reachable from the banner, so an operator who
      // chose "later" has somewhere to go later. Idempotent by single flight, and
      // safe to call when there is nothing to do — `runBackfill` decides that from
      // the record, which is what lets a button not have to know the state.
      .post("/api/migration/backfill", { requireAdmin: true }, () => ({
        backfill: backfill.start(),
      }))
      // Put the banner away for a week. Not forever: see SNOOZE_DAYS.
      .post("/api/migration/notice/snooze", { requireAdmin: true }, async () => {
        const snoozedUntil = new Date(Date.now() + SNOOZE_DAYS * 86_400_000).toISOString();
        return await setMigrationNotice({ snoozedUntil });
      })
      // Bring it straight back — the undo for the click above.
      .delete("/api/migration/notice/snooze", { requireAdmin: true }, async () => {
        await setMigrationNotice({ snoozedUntil: null });
        return await getMigrationNotice();
      })
  );
};
