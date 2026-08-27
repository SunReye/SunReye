/**
 * HOLDING HOME ASSISTANT DISCOVERY until the operator has named their plant and
 * device.
 *
 * A discovery announcement is RETAINED on the broker and Home Assistant keys its
 * entities on `unique_id`. Announcing under a placeholder identity is therefore
 * not something a later rename can take back: the old entities stay, the new ones
 * appear beside them, and every automation and dashboard card the operator built
 * points at the wrong half. That is why the plant name is a REQUIRED field of
 * migration onboarding rather than a setting with a default, and why this gate
 * exists rather than a "we'll rename it later".
 *
 * ## Why a module-level flag and not a lookup
 *
 * The publish happens inside MQTT's synchronous `connect` handler
 * (`../inverter/mqtt.ts`), which cannot await a database read, and a reconnect
 * storm would do it once per attempt. So the flag is set once at boot from the
 * migration record and cleared exactly once, by the operator confirming their
 * names — and clearing it NOTIFIES, so the announcement happens then rather than
 * whenever the broker next happens to drop the connection.
 *
 * ## Why it defaults to NOT held
 *
 * Every install that never ran a 1.x upgrade must be unaffected. A gate that
 * defaulted to held and depended on something clearing it would, on the first
 * boot where that something failed, look exactly like a broken MQTT bridge — and
 * the operator would have no reason to connect the two.
 */

/** The one piece of state. Not held unless something says so. */
let heldReason: string | null = null;

/** Called when the gate lifts, so the bridge can announce immediately. */
const listeners = new Set<() => void>();

/** Whether discovery must not be announced yet, and why. */
export function discoveryHeld(): string | null {
  return heldReason;
}

/**
 * Hold discovery. Idempotent, and the reason is kept for the log and the API.
 *
 * Called from the boot chain when the migration record says onboarding has not
 * been completed — never from a request, because a request cannot know whether an
 * announcement has already gone out.
 */
export function holdDiscovery(reason: string): void {
  heldReason = reason;
}

/**
 * Lift the gate and announce.
 *
 * A no-op when it was not held, so a second confirmation does not republish every
 * retained config for no reason.
 */
// fallow-ignore-next-line unused-export -- lifted by migration onboarding when the operator confirms their names — that route is the one piece of this upgrade still unbuilt. Proved by ./discovery-gate.test.ts and ../inverter/mqtt.test.ts; test files are not traced as consumers.
export function releaseDiscovery(): void {
  if (heldReason === null) return;
  heldReason = null;
  for (const listener of listeners) listener();
}

/** Subscribe to the lift. Returns the unsubscribe, so a restarted bridge cannot leak. */
export function onDiscoveryRelease(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Reset both the flag and the listeners.
 *
 * @internal For tests only. A module holding process state has to be resettable
 * by value: `mock.module` is process-global and permanent in this repo, so
 * re-importing to get a fresh instance is not available.
 */
export function resetDiscoveryGate(): void {
  heldReason = null;
  listeners.clear();
}
