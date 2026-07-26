/**
 * Runtime state for composite controls (`controlExpr`) that need memory — today
 * `snapshotToggle`, which captures a target register's value on lock and
 * restores it on unlock. Stored in `app_settings` under {@link CONTROL_STATE_KEY}.
 *
 * Presence-based: an entry exists only while a control is engaged (locked); it
 * is deleted on release. Keys are namespaced by active profile id so each
 * inverter profile keeps its own lock state — `${profileId}:${metricKey}`.
 */

import { z } from "zod";

/** `app_settings.key` under which composite-control runtime state is stored. */
export const CONTROL_STATE_KEY = "controlState";

/** One engaged lock: the value to restore, and when it was captured. */
const controlLockSchema = z.object({
  previousValue: z.number(),
  lockedAt: z.string(),
});

/** Map of `${profileId}:${metricKey}` → engaged lock. Absent key = released. */
export const controlStateSchema = z.record(z.string(), controlLockSchema);
export type ControlState = z.infer<typeof controlStateSchema>;

/** Empty state used before any control is engaged. */
export const defaultControlState: ControlState = {};

/** Compose the namespaced state key for a control on a given profile. */
export function controlStateKey(profileId: string, metricKey: string): string {
  return `${profileId}:${metricKey}`;
}
