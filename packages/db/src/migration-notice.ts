/**
 * THE MISSING-HISTORY NOTICE's own `app_settings` row.
 *
 * One field, and it has a row of its own rather than a field on `./ui-prefs.ts`
 * for a reason that has already cost this repo a bug: `uiPrefs` is written by a
 * settings form that PUTs the whole record, so a field added there is a field the
 * next "hide this metric" save silently resets. A snooze that quietly cancels
 * itself when somebody hides a chart is worse than no snooze at all.
 *
 * It is also not a `notifications` table. There is no such table, one row of one
 * field does not justify one, and `app_settings` is the shape every other
 * instance-wide preference in this codebase already has.
 *
 * FLAT and every field optional with a `catch`, for the reason spelled out in
 * `./upgrade-state.ts`: `readSetting` `safeParse`s to the DEFAULT with no log
 * line, so a required field turns one unparseable value into "nothing was ever
 * stored". Here that direction is the safe one anyway — the default SHOWS the
 * banner — and it stays flat so it cannot become the other kind of accident.
 */

import { z } from "zod";

/** `app_settings.key` the notice's state lives under. */
export const MIGRATION_NOTICE_KEY = "migrationNotice";

export const migrationNoticeSchema = z
  .object({
    /**
     * When the snoozed banner comes back, ISO — or `null` for "showing".
     *
     * A snooze, not a dismissal. The banner exists because a deferred migration
     * that leaves the app looking complete never gets run, and a permanent
     * dismissal is exactly that state one click later.
     */
    snoozedUntil: z.string().nullable().catch(null).default(null),
  })
  .strict();

export type MigrationNotice = z.infer<typeof migrationNoticeSchema>;

/** Showing. The state every install starts in. */
export const defaultMigrationNotice: MigrationNotice = migrationNoticeSchema.parse({});
