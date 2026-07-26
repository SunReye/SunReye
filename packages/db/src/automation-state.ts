/**
 * Runtime state for automations that take ownership of a register — today the
 * peak-shaving loop, which snapshots the user's charge-current value when it
 * becomes active and restores it when it lets go (disable/idle/blocked).
 * Stored in `app_settings` under {@link AUTOMATION_STATE_KEY}.
 *
 * Presence-based, like control-state: an entry exists only while an automation
 * holds the register; it is deleted after restore. Keys are namespaced by
 * active profile id — `${profileId}:${automationId}` — so a snapshot taken on
 * one profile is never replayed onto another profile's register.
 */

import { z } from "zod";

/** `app_settings.key` under which automation runtime state is stored. */
export const AUTOMATION_STATE_KEY = "automationState";

/** One held register: the value to restore, and when it was captured. */
const automationSnapshotSchema = z.object({
  previousValue: z.number(),
  capturedAt: z.string(),
});

/** Map of `${profileId}:${automationId}` → snapshot. Absent key = released. */
export const automationStateSchema = z.record(z.string(), automationSnapshotSchema);
export type AutomationState = z.infer<typeof automationStateSchema>;

/** Empty state used before any automation holds a register. */
export const defaultAutomationState: AutomationState = {};

/** Compose the namespaced state key for an automation on a given profile. */
export function automationStateKey(profileId: string, automationId: string): string {
  return `${profileId}:${automationId}`;
}
