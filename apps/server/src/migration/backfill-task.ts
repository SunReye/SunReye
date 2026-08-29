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
 *
 * ## Why the wiring goes through an io seam
 *
 * The same reason, one level out. {@link runMigrationBackfill} issues no SQL of its
 * own: it resolves WHERE the history may be written, opens a connection, hands the
 * driver its input and reports what came back. Those are decisions — the two
 * refusals, the config keys and cadence the driver is handed, and the horizon memo
 * that must be forgotten afterwards — and every one of them is wrong-able without a
 * statement being wrong. {@link BackfillIo} defaults to {@link productionBackfillIo}
 * as a parameter, so no call site changes; it is the seam `admin/archive-download.ts`
 * and `scripts/upgrade-rehearsal.ts` already use. The statements themselves stay
 * proved where statements have to be proved: `apps/server/db-tests/upgrade.test.ts`
 * against a real TimescaleDB, and `scripts/upgrade-phases.ts` end to end.
 */

import type { BackfillInput } from "@SunReye/db/backfill";
import type { BackfillResult } from "@SunReye/db/backfill-run";
import type { MigrationRecord } from "@SunReye/db/upgrade-state";
import type { UpgradeClient } from "@SunReye/db/upgrade-120-run";
import type { UpgradeConnection } from "@SunReye/db/upgrade-connect";
import type { PlantDb } from "@SunReye/db/plant-repo";

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

/** A device as {@link backfillTarget} reads one. */
export interface TargetDevice {
  id: number;
  profileId: string;
  role: string;
}

/** Everything this module touches that is not a decision. */
export interface BackfillIo {
  /** Read late: the addon's connection string is not known at import time. */
  databaseUrl(): string;
  readRecord(): Promise<MigrationRecord>;
  readPlant(): Promise<{ id: number } | null>;
  readDevices(plantId: number): Promise<readonly TargetDevice[]>;
  /**
   * ITS OWN CONNECTION, not the shared pool. The backfill is minutes of
   * statements; holding a pooled connection for that long would starve the poll
   * loop, which is writing to the same database at 1 Hz.
   */
  withClient<T>(url: string, body: (client: UpgradeClient) => Promise<T>): Promise<T>;
  readCadenceMs(client: UpgradeClient): Promise<number | null>;
  runBackfill(client: UpgradeClient, input: BackfillInput): Promise<BackfillResult | null>;
  /** Forget the history-horizon memo. See the note at the end of the run. */
  invalidate(): void;
  warn(message: string, fields: Record<string, unknown>): void;
  info(message: string, fields: Record<string, unknown>): void;
}

/**
 * The singletons {@link backfillIo} wires the seam from.
 *
 * A factory over these rather than a literal of arrows, for the reason the seam
 * exists at all: the WIRING is a thing that can be wrong on its own. Handing
 * `readDevices` the plant's id and `readPlant` nothing is a swap no statement
 * would catch, and it would attribute two months of history to the wrong device.
 */
export interface BackfillWiring {
  database: PlantDb;
  /** Read late: the addon's connection string is not known at import time. */
  databaseUrl(): string;
  logger: {
    warn(message: string, fields: Record<string, unknown>): void;
    info(message: string, fields: Record<string, unknown>): void;
  };
  /** Injected only by a test; production takes `withUpgradeClient`'s own default. */
  connect?: (databaseUrl: string) => UpgradeConnection;
}

/** The real wiring, over collaborators that are parameters. */
// fallow-ignore-next-line unused-export -- the production seam, built below and never named again; exported so ./backfill-task.test.ts can build the same wiring over doubles and prove each member routes where it should.
export function backfillIo(wiring: BackfillWiring): BackfillIo {
  return {
    databaseUrl: () => wiring.databaseUrl(),
    readRecord: () => readMigrationRecord(wiring.database),
    readPlant: () => readPlant(wiring.database),
    readDevices: (plantId) => readDevices(wiring.database, plantId),
    withClient: (url, body) => withUpgradeClient(url, body, wiring.connect),
    readCadenceMs: (client) => readLegacyCadenceMs(client),
    runBackfill: (client, input) => runBackfill(client, input),
    invalidate: () => invalidateHistoryLimits(),
    warn: (message, fields) => wiring.logger.warn(message, fields),
    info: (message, fields) => wiring.logger.info(message, fields),
  };
}

/** The seam every caller gets when it passes none. */
const productionBackfillIo: BackfillIo = backfillIo({
  database: db,
  databaseUrl: () => env.DATABASE_URL,
  logger: log("migration"),
});

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
export async function runMigrationBackfill(
  configKeys: readonly string[],
  io: BackfillIo = productionBackfillIo,
): Promise<void> {
  const record = await io.readRecord();
  const plant = await io.readPlant();
  const target = backfillTarget(
    record,
    plant,
    plant === null ? [] : await io.readDevices(plant.id),
  );
  if (!target.ok) {
    io.warn("history backfill has nowhere to write: {reason}", { reason: target.reason });
    return;
  }

  await io.withClient(io.databaseUrl(), async (client) => {
    const rawDurMs = await io.readCadenceMs(client);
    io.info("history backfill starting: device {deviceId}, legacy cadence {rawDurMs} ms", {
      deviceId: target.deviceId,
      rawDurMs,
    });
    const result = await io.runBackfill(client, {
      deviceId: target.deviceId,
      configKeys,
      rawDurMs,
      logger: { log: (line: string) => io.info("{line}", { line }) },
    });
    if (result === null) {
      io.info("nothing to backfill: the migration record says it is already done", {});
      return;
    }
    io.info(
      "history backfill complete in {seconds}s: {carried} carried raw rows, {replayed} replayed bucket rows, {refreshed} refresh window(s) \u2014 stage {stage}",
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
  io.invalidate();
}
