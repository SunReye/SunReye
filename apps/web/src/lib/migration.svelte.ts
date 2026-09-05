import { api } from "$lib/api";
import { historyIncomplete } from "$lib/history-incomplete.svelte";
import { type ConfirmResult, refusalOf } from "$lib/migration-submit";

/**
 * The migration status, as `GET /api/migration/status` sends it.
 *
 * A local type rather than an import from the server package, per the web
 * convention (see `$lib/display.svelte.ts`). It mirrors `MigrationView` in
 * `apps/server/src/migration/onboarding-apply.ts`.
 */
type MigrationStatus = {
  /** Show the onboarding form, and hold Home Assistant discovery, until false. */
  onboardingRequired: boolean;
  /** The history backfill has not finished. A DEFERRED migration counts. */
  backfillOutstanding: boolean;
  /** The server's sentence naming what is missing, or null. */
  banner: string | null;
  /** Oldest instant the new schema can answer, ISO — or null for "all of it". */
  historyFrom: string | null;
  plantName: string;
  deviceName: string;
  /** The slugs as they stand: what the live preview starts from. */
  plantSlug: string;
  deviceSlug: string;
  /** Whether the ONE-TIME slug correction is still reachable. */
  slugEditable: boolean;
  bannerSnoozed: boolean;
  backfillRunning: boolean;
};

/** What the form submits. Both names required; a slug only when it was edited. */
type ConfirmNames = {
  plantName: string;
  deviceName: string;
  plantSlug?: string;
  deviceSlug?: string;
  migrateHistory: "now" | "later";
};

/**
 * The 1.2.0 -> 2.0.0 migration, on the client.
 *
 * One store, because the same status answers three unrelated questions and a fetch
 * each would ask them separately: whether the app shell must divert to the
 * onboarding form, what the app-wide banner says, and what the form pre-fills
 * with. The server sends all of it in one payload for exactly that reason.
 *
 * The status is re-read after every write rather than patched locally. Confirming
 * the names releases the discovery gate and may start a three-minute backfill, so
 * several fields move at once and the server is the only thing that knows which.
 */
class MigrationStore {
  status = $state<MigrationStatus | null>(null);
  #loadPromise: Promise<void> | null = null;

  /** Read the status once per session. Concurrent callers share the request. */
  load(): Promise<void> {
    this.#loadPromise ??= this.refresh();
    return this.#loadPromise;
  }

  /** Read it again — after a write, or while a backfill is running. */
  async refresh(): Promise<void> {
    const { data } = await api.api.migration.status.get();
    if (data) this.status = data as MigrationStatus;
  }

  /**
   * Confirm the names, and the slugs if they were edited.
   *
   * A slug is sent ONLY when the operator changed it. Sending the unchanged
   * derived value would be harmless (the server treats an equal slug as no
   * change) but it would make the request indistinguishable from a real edit in
   * the log of the one write that cannot be undone.
   */
  async confirm(input: ConfirmNames): Promise<ConfirmResult> {
    const { error } = await api.api.migration.names.post(input);
    if (error) return refusalOf(error);
    await this.refresh();
    return { ok: true };
  }

  /** Run the deferred backfill now. Single-flight on the server. */
  async runBackfill(): Promise<boolean> {
    const { error } = await api.api.migration.backfill.post();
    if (error) return false;
    await this.refresh();
    // The horizon is about to move, so the refusals already collected are stale.
    historyIncomplete.clear();
    return true;
  }

  /** Put the banner away for a week. It comes back — see the server's SNOOZE_DAYS. */
  async snooze(): Promise<void> {
    const { error } = await api.api.migration.notice.snooze.post();
    if (!error) await this.refresh();
  }
}

export const migration = new MigrationStore();
