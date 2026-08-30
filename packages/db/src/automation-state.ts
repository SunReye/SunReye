/**
 * Runtime state for automations that take ownership of a register — today the
 * peak-shaving loop, which snapshots the user's charge-current value when it
 * becomes active and restores it when it lets go (disable/idle/blocked).
 * Stored in `app_settings` under {@link AUTOMATION_STATE_KEY}.
 *
 * Presence-based, like control-state: an entry exists only while an automation
 * holds the register; it is deleted after restore. Keys are namespaced by the
 * DEVICE the register belongs to — `${deviceId}:${automationId}` — so a
 * snapshot taken on one machine is never replayed onto another's register.
 *
 * They were namespaced by PROFILE id until 2.0.0, which is the same defect
 * `metrics_raw` was re-keyed to `device_id` to kill: correct or swap the profile
 * and the held snapshot is orphaned, so the user's own charge-current value can
 * no longer be restored. {@link migrateAutomationState} re-keys the blob once,
 * on the first read after the upgrade.
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

/** Map of `${deviceId}:${automationId}` → snapshot. Absent key = released. */
export const automationStateSchema = z.record(z.string(), automationSnapshotSchema);
export type AutomationState = z.infer<typeof automationStateSchema>;

/** Empty state used before any automation holds a register. */
export const defaultAutomationState: AutomationState = {};

/** Compose the namespaced state key for an automation on a given device. */
export function automationStateKey(deviceId: string, automationId: string): string {
  return `${deviceId}:${automationId}`;
}

/** State key for a borrowed EVCC loadpoint mode on a given device. */
export function evccModeStateKey(deviceId: string, loadpoint: number): string {
  return `${deviceId}:evccMode:${loadpoint}`;
}

/**
 * State key for a borrowed EVCC battery-boost SOC limit on a given device.
 *
 * A second key rather than a richer snapshot record: see the note on
 * {@link automationSnapshotSchema} for why that record must stay parseable by
 * every row ever written.
 */
export function evccBoostLimitStateKey(deviceId: string, loadpoint: number): string {
  return `${deviceId}:evccBoostLimit:${loadpoint}`;
}

/**
 * What one registered device binds today: its id (`devices.slug`) and the
 * profile its row names. The only thing the one-time re-key needs to know.
 */
export interface DeviceProfileBinding {
  deviceId: string;
  profileId: string;
}

/** The outcome of one re-key pass over a stored blob. */
export interface AutomationStateMigration {
  /** The blob as it should now be stored. */
  state: AutomationState;
  /** True when at least one key was re-keyed — and only then must it be written. */
  changed: boolean;
  /**
   * Old-shape keys nothing could adopt, left EXACTLY as they were.
   *
   * Never dropped, and that is the whole point of reporting them: every entry
   * here is a register value the user themselves set, which the automation
   * borrowed and has not handed back. Losing one is unrecoverable — the original
   * setting exists nowhere else — so an entry that cannot be re-keyed stays put
   * and is named, for the operator to put back by hand.
   */
  orphans: readonly string[];
}

/**
 * Re-key a stored blob from `${profileId}:…` to `${deviceId}:…`, once.
 *
 * Idempotent by construction: an entry whose namespace is already a registered
 * device id is recognised and left alone, so the pass reports `changed: false`
 * on everything it has already migrated and the caller writes nothing. That is
 * what makes it safe to run on every read — there is no "have I migrated yet"
 * flag to get out of step with the data.
 *
 * ADOPTION IS ONLY EVER UNAMBIGUOUS ADOPTION. A profile-keyed entry moves only
 * when EXACTLY ONE registered device names that profile. Two devices sharing one
 * profile is an ordinary plant (two identical inverters) and is precisely the
 * state the old key shape could not represent; picking one would restore one
 * machine's register value onto the other's. A profile no device names any more
 * has nobody to adopt it at all. Both land in {@link AutomationStateMigration.orphans}.
 */
export function migrateAutomationState(
  state: AutomationState,
  bindings: readonly DeviceProfileBinding[],
): AutomationStateMigration {
  const deviceIds = new Set(bindings.map((b) => b.deviceId));
  const byProfile = new Map<string, string[]>();
  for (const { deviceId, profileId } of bindings) {
    byProfile.set(profileId, [...(byProfile.get(profileId) ?? []), deviceId]);
  }

  const next: AutomationState = {};
  const orphans: string[] = [];
  let changed = false;
  for (const [key, snapshot] of Object.entries(state)) {
    const adopted = adoptedKey(key, deviceIds, byProfile);
    // Nobody to adopt it, or a device-keyed entry for the same slot already
    // exists — that one is what the running engine wrote last, so it wins and
    // the stale one is kept rather than overwritten or dropped.
    if (adopted === null || (adopted !== key && adopted in state)) {
      next[key] = snapshot;
      orphans.push(key);
      continue;
    }
    next[adopted] = snapshot;
    changed ||= adopted !== key;
  }
  return { state: changed ? next : state, changed, orphans };
}

/**
 * The key `key` should be stored under, or null when no single device can claim
 * it. Returns `key` unchanged when it is already namespaced by a registered
 * device — which is what makes the pass idempotent.
 */
function adoptedKey(
  key: string,
  deviceIds: ReadonlySet<string>,
  byProfile: ReadonlyMap<string, readonly string[]>,
): string | null {
  const cut = key.indexOf(":");
  if (cut === -1) return null;
  const namespace = key.slice(0, cut);
  // The device reading wins a slug/profile-id collision: it is the shape the
  // engine writes today.
  if (deviceIds.has(namespace)) return key;
  const owners = byProfile.get(namespace) ?? [];
  return owners.length === 1 ? `${owners[0]}${key.slice(cut)}` : null;
}

/** A snapshot's value when it is a register number, else null. */
export function numericSnapshot(value: number | string | undefined): number | null {
  return typeof value === "number" ? value : null;
}
