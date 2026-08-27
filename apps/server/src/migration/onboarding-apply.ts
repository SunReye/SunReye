/**
 * MIGRATION ONBOARDING against the database: what to show, and what one submit
 * writes.
 *
 * The decisions are not here. `./onboarding.ts` decides what to ask and what the
 * banner says; `./onboarding-plan.ts` decides what may be written and whether the
 * slug window is still open. This module is the reads, the writes and their ORDER
 * — which is the only thing about it worth arguing over.
 *
 * ## The order of the writes, and why it is that order
 *
 * One submit does five things, and every one of them can fail:
 *
 *  1. the slugs, if corrected. FIRST, because they are the only irreversible part
 *     and the only part with a real chance of failing (`plants_slug_unique`). A
 *     collision must abort the whole submit while the form is still open, not
 *     after the record has been stamped and the gate released — that would leave
 *     an instance announced under the old slug with no way back to the form.
 *  2. the names. Freely editable afterwards, so their failure costs nothing.
 *  3. the migration RECORD (`namesConfirmedAt`, and `deferred` when the operator
 *     chose later). Before the gate is released, because the record is the durable
 *     half: a crash between the two leaves discovery held and the form closed,
 *     which the next boot repairs by simply not holding the gate. The reverse order
 *     would announce under names nothing had recorded.
 *  4. the gate. Releasing it publishes the retained discovery announcement
 *     immediately (`./discovery-gate.ts` notifies rather than waiting for the next
 *     reconnect), which is why it is last: everything the announcement is built
 *     from must already be on disk.
 *  5. the history-limits memo, because the horizon has just moved.
 */

import { db } from "@SunReye/db";
import { readDevices, readPlant, reslugForMigrationOnboarding } from "@SunReye/db/plant-repo";
import { updateDevice, updatePlant } from "@SunReye/db/plant-repo";
import { type MigrationRecord, migrationRecordSchema } from "@SunReye/db/upgrade-state";
import { type UpgradeClient, writeMigrationRecord } from "@SunReye/db/upgrade-120-run";

import { getActiveProfileOrNull } from "../inverter/inverter";
import { invalidateHistoryLimits } from "../shared/history-horizon-live";
import { log } from "../shared/logging";
import { getMigrationNotice } from "../settings/migration-notice-settings";
import { discoveryHeld, releaseDiscovery } from "./discovery-gate";
import { type MigrationStatus, defaultDeviceName, migrationStatus } from "./onboarding";
import {
  type GateState,
  type OnboardingInput,
  type OnboardingPlan,
  type OnboardingRefusal,
  bannerSuppressed,
  migratedDevice,
  planOnboarding,
  slugFrozen,
} from "./onboarding-plan";
import { readMigrationRecord } from "./record";

/** Everything the onboarding form and the app-wide banner render from. */
export interface MigrationView extends MigrationStatus {
  /** The slugs as they stand — what the form's live preview starts from. */
  plantSlug: string;
  deviceSlug: string;
  /** Whether the ONE-TIME slug correction is still reachable. */
  slugEditable: boolean;
  /** Whether the banner is snoozed right now. `banner` is unchanged either way. */
  bannerSnoozed: boolean;
}

/**
 * The shared pool as the `{ query }` client `@SunReye/db/upgrade-120-run` takes.
 *
 * Safe here and ONLY here: this is one `insert … on conflict` with no surrounding
 * transaction. The backfill needs a dedicated connection for exactly the opposite
 * reason — see `@SunReye/db/upgrade-connect`.
 */
function sharedUpgradeClient(): UpgradeClient {
  const client = db.$client as {
    query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  };
  return { query: (text, values) => client.query(text, values ? [...values] : undefined) };
}

/** One resolved plant/device pair, with every nullable already answered. */
interface Spine {
  plantId: number;
  plantSlug: string;
  deviceId: number | null;
  deviceSlug: string;
}

/** Fallbacks for an instance whose spine is somehow not provisioned yet. */
const NO_PLANT = { id: null as number | null, name: "", slug: "" };

/**
 * The plant, its migrated device, and the names to pre-fill.
 *
 * `defaultDeviceName` is the fallback for a BLANK device name, not the first
 * choice: provisioning already put the profile's own name there, and an operator
 * who renamed it must see their name, not a re-derived one. A blank field is the
 * one submitted without reading, and what is submitted here is frozen.
 */
async function spine() {
  const plant = (await readPlant(db)) ?? null;
  if (plant === null) return { plant: NO_PLANT, device: null, rows: null };
  const record = await readMigrationRecord();
  const device = migratedDevice(await readDevices(db, plant.id), record.sourceId);
  // The same four values with every nullable already resolved. Built HERE rather
  // than at each write step, because a `?? ""` repeated per caller is how the
  // "which slug is on disk" answer starts differing between the refusal path and
  // the write path.
  const rows: Spine = {
    plantId: plant.id,
    plantSlug: plant.slug,
    deviceId: device?.id ?? null,
    deviceSlug: device?.slug ?? "",
  };
  return { plant, device, rows };
}

/** The gate's state as a value, so the pure rules can read it. */
async function gateState(): Promise<GateState> {
  return { record: await readMigrationRecord(), discoveryHeld: discoveryHeld() };
}

/** What the status endpoint answers, and what the page paints from. */
export async function readMigrationView(): Promise<MigrationView> {
  const state = await gateState();
  const { plant, device } = await spine();
  const profile = getActiveProfileOrNull();
  const status = migrationStatus(state.record, {
    plantName: plant.name,
    deviceName:
      device?.name.trim() ||
      (profile === null ? "" : defaultDeviceName({ id: profile.id, name: profile.name })),
  });
  const notice = await getMigrationNotice();
  return {
    ...status,
    plantSlug: plant.slug,
    deviceSlug: device?.slug ?? "",
    slugEditable: !slugFrozen(state),
    bannerSnoozed: bannerSuppressed(notice.snoozedUntil, new Date()),
  };
}

/** What a successful submit reports back. */
export interface OnboardingApplied {
  ok: true;
  plantName: string;
  deviceName: string;
  plantSlug: string;
  deviceSlug: string;
  /** Whether the operator asked for the history now. */
  migrateNow: boolean;
}

/**
 * STEP 1 — the slugs, if either was corrected.
 *
 * First, and alone in its failure mode: a collision (`plants_slug_unique`) must
 * abort the whole submit while the form is still open, not after the record has
 * been stamped and the gate released.
 */
async function writeSlugs(plan: OnboardingPlan, spine: Spine): Promise<void> {
  if (plan.plantSlug === null && plan.deviceSlug === null) return;
  await reslugForMigrationOnboarding(db, {
    plantId: spine.plantId,
    ...(plan.plantSlug === null ? {} : { plantSlug: plan.plantSlug }),
    deviceId: spine.deviceId,
    ...(plan.deviceSlug === null ? {} : { deviceSlug: plan.deviceSlug }),
  });
  log("migration").info(
    "migration onboarding corrected the frozen slugs to {plantSlug}/{deviceSlug} — the last moment this was possible",
    {
      plantSlug: plan.plantSlug ?? spine.plantSlug,
      deviceSlug: plan.deviceSlug ?? spine.deviceSlug,
    },
  );
}

/** STEP 2 — the names. Freely editable afterwards, so a failure costs nothing. */
async function writeNames(plan: OnboardingPlan, spine: Spine): Promise<void> {
  await updatePlant(db, spine.plantId, { name: plan.plantName });
  if (spine.deviceId !== null) {
    await updateDevice(db, spine.deviceId, { name: plan.deviceName });
  }
}

/**
 * STEP 3 — the migration record, which is what CLOSES onboarding.
 *
 * `deferred` is a RECORDED decision: it keeps the horizon and the banner, because
 * a deferral that leaves the app looking complete never gets run. `now` leaves the
 * stage where it is — the backfill advances it itself.
 *
 * Written through the upgrade's own `writeMigrationRecord` rather than a second
 * upsert of our own: the `$2::text::jsonb` in there is the difference between a
 * stored jsonb DOCUMENT and a stored JSON *string*, and getting it wrong reads
 * back as "no migration ever happened here".
 */
async function stampRecord(record: MigrationRecord, migrateNow: boolean): Promise<void> {
  await writeMigrationRecord(
    sharedUpgradeClient(),
    migrationRecordSchema.parse({
      ...record,
      stage: migrateNow ? record.stage : "deferred",
      namesConfirmedAt: new Date().toISOString(),
    }),
  );
}

/**
 * Confirm the names — and, while the window is open, correct the slugs.
 *
 * Returns the plan's own refusal unchanged, so the route restates none of the
 * rules. The one thing added here is the CURRENT slugs, read before the decision:
 * without them every submitted slug looks like a change, and the second submit of
 * an unedited form would be refused for no reason.
 *
 * The five steps are in the order the module note argues for, and each is its own
 * function so that order is readable as a list rather than inferred from 70 lines.
 */
export async function applyOnboarding(
  input: OnboardingInput,
): Promise<OnboardingApplied | OnboardingRefusal> {
  const state = await gateState();
  const { rows } = await spine();
  const plan = planOnboarding(state, input, rows ?? undefined);
  if (!plan.ok) return plan;
  if (rows === null) {
    return {
      ok: false,
      status: 409,
      error: "onboarding_closed",
      message: "This instance has no plant row yet, so there is nothing to name.",
    };
  }

  await writeSlugs(plan, rows);
  await writeNames(plan, rows);
  await stampRecord(state.record, plan.migrateNow);
  // The gate LAST: releasing it publishes the retained announcement immediately,
  // so everything the announcement is built from must already be on disk.
  releaseDiscovery();
  // The horizon has moved.
  invalidateHistoryLimits();

  return {
    ok: true,
    plantName: plan.plantName,
    deviceName: plan.deviceName,
    plantSlug: plan.plantSlug ?? rows.plantSlug,
    deviceSlug: plan.deviceSlug ?? rows.deviceSlug,
    migrateNow: plan.migrateNow,
  };
}
