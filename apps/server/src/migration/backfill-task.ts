/**
 * "MIGRATE HISTORY NOW": the backfill as a background task the route can start.
 *
 * The operator's other option is "later", which is a recorded decision (stage
 * `deferred`) and a banner — not a silence. This module is the `now` half.
 *
 * ## Why it is fire-and-forget, and why that needs a single-flight guard
 *
 * The backfill cannot be awaited by a request. Measured against the restored
 * 60-day fixture it is 170.8 s for 5.7M replayed rows; it does not fit in any HTTP
 * timeout and it does not fit in `sunreye/config.yaml`'s 120 s Supervisor timeout
 * either, which is why `@SunReye/db/backfill-run` was built resumable in the first
 * place. So the route starts it and answers immediately, and the status endpoint is
 * how progress is observed (the migration record's stage advances as it goes).
 *
 * Because nothing awaits it, a second click must not start a second one. Two
 * copies racing the shared `replay_progress` watermarks is the one way to lose a
 * chunk that each believes the other recorded — every unit of work commits its own
 * watermark row inside its own transaction, and that is only a guarantee while
 * there is one writer. Hence {@link createBackfillTask}, which is the whole reason
 * this is a factory rather than a function: the guard is state, and state that
 * cannot be tested is state that will be wrong.
 *
 * ## Why the runner is injected
 *
 * `./backfill-task.test.ts` drives the single-flight rule with a promise it settles
 * by hand. The real runner needs a Postgres, a 1.2.0 fixture and three minutes; the
 * rule needs neither, and a rule proved only by the thing it guards is not proved.
 */

import { env } from "@SunReye/env/server";
import { db } from "@SunReye/db";
import { runBackfill } from "@SunReye/db/backfill-run";
import { readLegacyCadenceMs } from "@SunReye/db/upgrade-120-run";
import { withUpgradeClient } from "@SunReye/db/upgrade-connect";
import { readDevices, readPlant } from "@SunReye/db/plant-repo";

import { log } from "../shared/logging";
import { invalidateHistoryLimits } from "../shared/history-horizon-live";
import { readMigrationRecord } from "./record";
import { backfillTarget } from "./onboarding-plan";

/** What a start attempt did. Reported to the operator as-is. */
export type BackfillStart = "started" | "already-running";

export interface BackfillTaskDeps {
  /** The long-running work. Never awaited by the caller. */
  run: () => Promise<void>;
  /** Where a rejection goes. Absent means "drop it" — see the note below. */
  onError?: (error: unknown) => void;
}

export interface BackfillTask {
  start(): BackfillStart;
  running(): boolean;
}

/**
 * A one-at-a-time wrapper around the backfill.
 *
 * The flag is cleared in a `finally`, including on a THROW. Nothing awaits
 * `start()`, so a rejection has nowhere to surface on its own; if the flag
 * survived it, the button would answer "already running" for the rest of the
 * process's life and only a restart would clear it — an outage produced by the
 * error handling rather than by the error.
 */
export function createBackfillTask(deps: BackfillTaskDeps): BackfillTask {
  let inFlight = false;
  return {
    start() {
      if (inFlight) return "already-running";
      inFlight = true;
      void deps
        .run()
        .catch((error: unknown) => deps.onError?.(error))
        .finally(() => {
          inFlight = false;
        });
      return "started";
    },
    running: () => inFlight,
  };
}

/**
 * The real backfill, against this instance's database.
 *
 * `configKeys` is handed in from the ACTIVE PROFILE's manifest rather than derived
 * here, and it must be the profile's own answer (`resolveStorage`) — never a
 * `settings.%` prefix match, which is one vendor's naming. Getting it wrong does
 * not fail: configuration registers land in the hypertable instead of
 * `metrics_config_log`, quietly restoring the storage cost this release exists to
 * remove.
 *
 * Returns without doing anything when there is no migration to finish;
 * `runBackfill` decides that from the record, which is what makes this safe to
 * call from a button that cannot know the state.
 */
// fallow-ignore-next-line complexity -- coverage, not complexity: cyclomatic 4. This is the SQL-issuing driver, and its coverage is zero BY DESIGN (CONTRIBUTING.md §6 — a SQL-text assertion cannot prove a query runs). Every DECISION it makes is in `backfillTarget` and `createBackfillTask` above, both unit-proved; what is left is the wiring, exercised against a real database by scripts/upgrade-phases.ts and verified by hand against a booted server.
export async function runMigrationBackfill(configKeys: readonly string[]): Promise<void> {
  const record = await readMigrationRecord();
  const plant = await readPlant(db);
  const target = backfillTarget(
    record,
    plant,
    plant === null ? [] : await readDevices(db, plant.id),
  );
  if (!target.ok) {
    log("migration").warn("history backfill has nowhere to write: {reason}", {
      reason: target.reason,
    });
    return;
  }

  await withUpgradeClient(env.DATABASE_URL, async (client) => {
    const rawDurMs = await readLegacyCadenceMs(client);
    log("migration").info(
      "history backfill starting: device {deviceId}, legacy cadence {rawDurMs} ms",
      { deviceId: target.deviceId, rawDurMs },
    );
    const result = await runBackfill(client, {
      deviceId: target.deviceId,
      configKeys,
      rawDurMs,
      logger: { log: (line: string) => log("migration").info("{line}", { line }) },
    });
    if (result === null) {
      log("migration").info("nothing to backfill: the migration record says it is already done");
      return;
    }
    log("migration").info(
      "history backfill complete in {seconds}s: {carried} carried raw rows, {replayed} replayed bucket rows, {refreshed} refresh window(s) — stage {stage}",
      {
        seconds: (result.elapsedMs / 1000).toFixed(1),
        carried: result.carried?.seriesRows ?? 0,
        replayed: result.replayed?.seriesRows ?? 0,
        refreshed: result.refreshed,
        stage: result.record.stage,
      },
    );
  });

  // The horizon has MOVED: the memo would otherwise keep refusing month-to-date
  // reads for its TTL after the data they need has landed.
  invalidateHistoryLimits();
}
