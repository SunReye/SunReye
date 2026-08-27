/**
 * The missing-history banner's snooze, cached in memory and invalidated on write.
 *
 * Its own row rather than a field on `uiPrefs` — see
 * `@SunReye/db/migration-notice` for why that distinction is load-bearing.
 */

import {
  MIGRATION_NOTICE_KEY,
  defaultMigrationNotice,
  migrationNoticeSchema,
} from "@SunReye/db/migration-notice";
import { cachedSetting } from "./app-settings";

const notice = cachedSetting(MIGRATION_NOTICE_KEY, migrationNoticeSchema, defaultMigrationNotice);

/** When the banner comes back, or `null` — falling back to "showing". */
export const getMigrationNotice = notice.get;

/** Validate and persist the snooze (upsert), refreshing the cache. */
export const setMigrationNotice = notice.set;
