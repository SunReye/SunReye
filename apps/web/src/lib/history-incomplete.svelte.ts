import { type IncompleteRange, incompleteRangeFrom, withNotice } from "$lib/history-incomplete";

/**
 * The refused ranges this session has seen, for the app-wide banner.
 *
 * Fed from `$lib/api.ts`'s `onResponse` — every response the typed client makes
 * passes through there, which is why no call site has to opt in. See
 * `$lib/history-incomplete.ts` for why one detector beats ten.
 *
 * Session-scoped and NOT cleared on navigation, deliberately: the fact the notice
 * reports ("this instance cannot answer a window that starts before X") is a
 * property of the instance, not of the page that happened to ask. Clearing it per
 * route would make the same warning flicker in and out as the operator moves
 * around, which is how a warning gets learned as noise.
 */
class HistoryIncompleteStore {
  notices = $state<readonly IncompleteRange[]>([]);

  /** Note a response, if it is one of these refusals. Cheap on every other. */
  observe(status: number, body: unknown): void {
    const notice = incompleteRangeFrom(status, body);
    if (notice === null) return;
    this.notices = withNotice(this.notices, notice);
  }

  /** Forget them — after a backfill finishes, the boundary has moved. */
  clear(): void {
    this.notices = [];
  }
}

export const historyIncomplete = new HistoryIncompleteStore();
