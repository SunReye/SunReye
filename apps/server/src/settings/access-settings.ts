/**
 * Access preferences (public read-only dashboard toggle), cached in memory and
 * invalidated on write. Persisted via the shared `app_settings` accessor.
 */

import { ACCESS_KEY, accessConfigSchema, defaultAccess } from "@SunReye/db/access";
import { cachedSetting } from "./app-settings";

const access = cachedSetting(ACCESS_KEY, accessConfigSchema, defaultAccess);

export const getAccess = access.get;
export const setAccess = access.set;

/** Whether anonymous dashboard reads are currently allowed. */
export async function isPublicDashboard(): Promise<boolean> {
  return (await getAccess()).publicDashboard;
}
