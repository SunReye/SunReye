/**
 * THE MIGRATION RECORD: how far the 1.2.0 -> 2.0.0 upgrade has got, and what is
 * therefore still missing from every read.
 *
 * Stored in `app_settings` under {@link MIGRATION_KEY} — the one table that
 * exists on both sides of the schema break, so the blocking step can write it
 * before the 2.0.0 baseline has created anything.
 *
 * ## Why a FLAT tagged record and not a discriminated union
 *
 * `readSetting` `safeParse`s and falls back to the DEFAULT with no log line. A
 * `z.discriminatedUnion` — or any required field — therefore turns one
 * unparseable field into "no migration ever happened here", silently, on the
 * document that decides whether an instance's only copy of two months of history
 * may be dropped. So: one `stage` tag, every other field optional with a
 * default, and an unknown `stage` degrades to `none` while the fields around it
 * survive. Pinned by `./upgrade-state.test.ts`.
 *
 * ## Why the stages are what they are
 *
 * The upgrade is three separate events with a user decision in the middle, and
 * each leaves a different amount of history readable:
 *
 *  * `cutover` — the blocking step ran. New readings land in the new schema from
 *    this instant; everything before it lives only in the inert `legacy_*`
 *    relations.
 *  * `carried` — the retained legacy raw window (seven days on 1.2.0) has been
 *    moved across. Cheap, and it recovers the week the operator is most likely
 *    to look at.
 *  * `deferred` — the operator chose "later". Deferring is NOT finishing: the
 *    horizon stays and the banner stays, because a deferred migration that
 *    leaves the app looking complete never gets run.
 *  * `backfilled` — the bucket replay is complete; every read can be answered.
 *  * `verified` — old and new agree (`scripts/db-parity.ts`). Only now may the
 *    legacy objects be dropped.
 *  * `dropped` — they are gone. The migration is over.
 */

import { z } from "zod";

/** `app_settings.key` the migration record lives under. */
export const MIGRATION_KEY = "migration.v2";

/** How far the upgrade has got. See the module note. */
export const MIGRATION_STAGES = [
  "none",
  "cutover",
  "carried",
  "deferred",
  "backfilled",
  "verified",
  "dropped",
] as const;

export type MigrationStage = (typeof MIGRATION_STAGES)[number];

/**
 * An ISO instant that degrades to `null` rather than failing the document.
 *
 * `z.string().datetime()` would reject and take the whole record down to its
 * defaults — see the module note on why that is the one failure mode this schema
 * exists to avoid.
 */
const instant = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)))
  .nullable()
  .catch(null)
  .default(null);

export const migrationRecordSchema = z.object({
  stage: z.enum(MIGRATION_STAGES).catch("none").default("none"),
  /** When the blocking step handed the schema over. The first horizon. */
  cutoverAt: instant,
  /** The 1.2.0 `inverter_id` — a PROFILE id — every legacy bucket carries. */
  sourceId: z.string().nullable().catch(null).default(null),
  /** Where the retained legacy raw began: the horizon once it is carried. */
  legacyRawFrom: instant,
  /** Exclusive end of the retained legacy raw window. */
  legacyRawTo: instant,
  /** Where the BUCKET replay must stop, so it cannot double-write the carry. */
  replayTo: instant,
  /**
   * When the operator confirmed the plant and device NAMES.
   *
   * `null` means migration onboarding has not been completed, and two things
   * follow from it: the app shows the onboarding form on first open, and Home
   * Assistant DISCOVERY IS HELD. Holding discovery is the load-bearing half —
   * a discovery announcement is retained and HA keys its entities on
   * `unique_id`, so entities announced under a placeholder identity are not
   * something a later rename can take back.
   */
  namesConfirmedAt: instant,
});

export type MigrationRecord = z.infer<typeof migrationRecordSchema>;

/** The record an install that never ran a 1.x upgrade reads back. */
export const noMigration: MigrationRecord = migrationRecordSchema.parse({});

/** Stages at which history before the cutover is still not readable. */
const WITHHOLDING: readonly MigrationStage[] = ["cutover", "carried", "deferred"];

/**
 * The oldest instant the NEW schema can answer, while a migration is
 * incomplete — or `null` when nothing is being withheld.
 *
 * `carried` reports `legacyRawFrom`, not `cutoverAt`: the carry has already put
 * that week into the new `metrics_raw`, and reporting the cutover would refuse
 * reads over data that is demonstrably there.
 *
 * A withholding stage with no usable date reports `null`. Refusing every read on
 * a bookkeeping field that failed to parse would take the dashboard down over
 * nothing, and the rule this whole mechanism serves is "never claim a number is
 * complete when it is not" — not "refuse when unsure what to claim".
 */
export function migrationHorizonFrom(record: MigrationRecord): Date | null {
  if (!WITHHOLDING.includes(record.stage)) return null;
  const iso =
    record.stage === "carried" ? (record.legacyRawFrom ?? record.cutoverAt) : record.cutoverAt;
  if (iso === null) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The banner text, which NAMES what is missing.
 *
 * "Some history is missing" is a sentence an operator cannot act on, and one they
 * stop reading after a week. A date they recognise is the thing that makes a
 * deferred migration get run.
 */
export function describeMissingHistory(record: MigrationRecord): string | null {
  const from = migrationHorizonFrom(record);
  if (from === null) return null;
  return `History before ${from.toISOString()} has not been migrated from the 1.2.0 database yet.`;
}

/** Stages at which a 1.x upgrade is still in progress at all. */
const IN_PROGRESS: readonly MigrationStage[] = [
  "cutover",
  "carried",
  "deferred",
  "backfilled",
  "verified",
];

/**
 * Whether migration onboarding still has to be shown — and therefore whether
 * discovery is held.
 *
 * Tied to the STAGE as well as the timestamp: an install that never ran a 1.x
 * upgrade has no names to confirm, and an install whose migration is fully over
 * (`dropped`) must not be asked again if the field was somehow lost. Both would
 * otherwise hold discovery forever on a healthy install, which looks exactly like
 * a broken MQTT bridge.
 */
export function needsMigrationOnboarding(record: MigrationRecord): boolean {
  return record.namesConfirmedAt === null && IN_PROGRESS.includes(record.stage);
}

/**
 * Whether the history backfill is still outstanding — the banner's condition.
 *
 * `deferred` counts. Deferring is not finishing: a deferred migration that leaves
 * the app looking complete never gets run, and the legacy objects then sit on
 * disk forever.
 */
export function backfillOutstanding(record: MigrationRecord): boolean {
  return WITHHOLDING.includes(record.stage);
}

/**
 * Whether the legacy hypertable and its aggregates may be dropped.
 *
 * ONLY after verification, and this is now the only thing standing between a
 * failed migration and data loss: there is no intermediate release, and no
 * user-performed export beforehand. Until then they stay — policy-free, unread,
 * and the rollback.
 */
export function mayDropLegacy(record: MigrationRecord): boolean {
  return record.stage === "verified";
}
