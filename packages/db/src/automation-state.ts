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
 *
 * The same map also holds what price-aware charging borrows from **EVCC
 * loadpoints** — the charge mode ({@link evccModeStateKey}) and the
 * battery-boost SOC limit ({@link evccBoostLimitStateKey}) — so a car commanded
 * for a negative-price window is handed back even across a restart.
 */

import { z } from "zod";

/** `app_settings.key` under which automation runtime state is stored. */
export const AUTOMATION_STATE_KEY = "automationState";

/**
 * One held thing: the value to restore, and when it was captured.
 *
 * `previousValue` is a union because not everything an automation takes over is
 * a register — an EVCC loadpoint's charge *mode* is a string. Widening the field
 * keeps the parse **total**: every row written before EV pull-in existed holds a
 * number and still parses unchanged. Turning this record into an object with two
 * sub-maps would have been cleaner to read and catastrophic in practice: every
 * existing row would fail validation, `readSetting` would substitute the default,
 * and a held charge-current register would lose the user's original value — only
 * recoverable by hand, out of the `<key>:rejected` quarantine row.
 */
const automationSnapshotSchema = z.object({
  previousValue: z.union([z.number(), z.string()]),
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

/** State key for a borrowed EVCC loadpoint mode on a given profile. */
export function evccModeStateKey(profileId: string, loadpoint: number): string {
  return `${profileId}:evccMode:${loadpoint}`;
}

/**
 * State key for a borrowed EVCC battery-boost SOC limit on a given profile.
 *
 * A second key rather than a richer snapshot record: see the note on
 * {@link automationSnapshotSchema} for why that record must stay parseable by
 * every row ever written.
 */
export function evccBoostLimitStateKey(profileId: string, loadpoint: number): string {
  return `${profileId}:evccBoostLimit:${loadpoint}`;
}

/** A snapshot's value when it is a register number, else null. */
export function numericSnapshot(value: number | string | undefined): number | null {
  return typeof value === "number" ? value : null;
}
