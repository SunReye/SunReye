import { api } from "$lib/api";
import { loadAutomationsGate } from "$lib/automations-gate";

/**
 * The automations master gate, as the nav sees it.
 *
 * A reactive singleton over `$lib/automations-gate` (the testable read lives
 * there). Fetched once per admin session and re-read on demand: the settings
 * form calls {@link AutomationsGateStore.refresh} after a successful save, so
 * turning the feature on makes the sidebar entry appear without a reload.
 *
 * Starts `false`, which is also the answer for every viewer who is not an
 * admin — the endpoint behind it is `requireAdmin`.
 */
class AutomationsGateStore {
  enabled = $state(false);
  #inFlight: Promise<void> | null = null;

  #fetchConfig = async (): Promise<unknown> => {
    const { data } = await api.api.settings.automations.get();
    return data;
  };

  /** Read the gate once per session. Repeat calls share the first request. */
  load(isAdmin: boolean): Promise<void> {
    this.#inFlight ??= loadAutomationsGate(isAdmin, this.#fetchConfig).then((on) => {
      this.enabled = on;
    });
    return this.#inFlight;
  }

  /** Re-read after a save, dropping the once-per-session memo. */
  refresh(isAdmin: boolean): Promise<void> {
    this.#inFlight = null;
    return this.load(isAdmin);
  }

  /**
   * Adopt a gate value the caller already holds — the settings form has the
   * saved config in hand, so the nav can update on the same frame as the save
   * instead of after a round trip.
   */
  adopt(enabled: boolean): void {
    this.enabled = enabled;
  }
}

export const automationsGate = new AutomationsGateStore();
