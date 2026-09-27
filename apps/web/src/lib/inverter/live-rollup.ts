/**
 * The rollup a history chart holds, and how it keeps up with a running window:
 * the window fetched once, a delta per minute tick, nothing written after its
 * reader left. Plain TS over `./live-tail`'s arithmetic — the refetch loops this
 * page shipped (PR #60, #216) lived in exactly this bookkeeping.
 */

import type { SourceId } from "$lib/source";
import { mergeRollup, type LiveWindow, type RollupRow } from "./live-tail";
import { overlayDelta } from "./overlay-chart";
import type { LivePoint } from "./types";

/** Rows held per metric key. */
export type HeldRows = Readonly<Record<string, RollupRow[]>>;

/** What a chart reads under: the selected source, or nothing for a plant-wide read. */
export type RollupScope = { source?: SourceId };

/** One scope for every key, or one per key — an overlay's series can each name a device. */
export type ScopeOf = RollupScope | ((metric: string) => RollupScope);

const scopeFor = (scope: ScopeOf, metric: string): RollupScope =>
  typeof scope === "function" ? scope(metric) : scope;

export type RollupQuery = RollupScope & {
  metric: string;
  from: string;
  to: string;
  bucket: LiveWindow["bucket"];
  limit: number;
};

/** `/api/history/rollup` — the Eden client in production, a fake in tests. */
export interface RollupApi {
  rollup(query: RollupQuery): Promise<{ data: unknown }>;
}

/** One key's fetched rows and the live frames past them — what a chart draws. */
export type RollupFeed = { key: string; rows: readonly RollupRow[]; live: readonly LivePoint[] };

/**
 * The feeds a chart draws, in `keys` order. `live` is null for a closed
 * window: a past day draws its rollup and nothing from the frame buffer.
 */
export function feedsFor(
  keys: readonly string[],
  rows: HeldRows,
  live: ((key: string) => readonly LivePoint[]) | null,
): RollupFeed[] {
  return keys.map((key) => ({ key, rows: rows[key] ?? [], live: live?.(key) ?? [] }));
}

/**
 * Row cap per request. A 7-day window renders as minute rollups (~10k points);
 * cap high enough that the ascending, limited query isn't truncated to the
 * oldest slice of the range.
 */
const LIMIT = 12000;

/**
 * One chart's rollup. `load` fetches a window in full and `append` asks only
 * for what a still-running one is missing; both return the disposer an
 * `$effect` hands back, after which their answer is never written.
 */
export function rollupFeed(deps: {
  api: RollupApi;
  /** The ticking minute (ms) — read when an answer LANDS. */
  now: () => number;
  onRows: (rows: HeldRows) => void;
  onLoading: (loading: boolean) => void;
}) {
  let rows: HeldRows = {};
  let loading = true;
  /** The clock minute the held rows were last brought up to. */
  let syncedTick = 0;

  const setRows = (next: HeldRows) => {
    rows = next;
    deps.onRows(next);
  };
  const setLoading = (next: boolean) => {
    loading = next;
    deps.onLoading(next);
  };

  async function fetchRows(
    keys: readonly string[],
    span: { from: Date; to: Date; bucket: LiveWindow["bucket"] },
    scope: ScopeOf,
  ): Promise<HeldRows> {
    const answers = await Promise.all(
      keys.map((metric) =>
        deps.api
          .rollup({
            metric,
            from: span.from.toISOString(),
            to: span.to.toISOString(),
            bucket: span.bucket,
            limit: LIMIT,
            ...scopeFor(scope, metric),
          })
          .then(({ data }) => [metric, (data ?? []) as RollupRow[]] as const),
      ),
    );
    return Object.fromEntries(answers);
  }

  return {
    get loading() {
      return loading;
    },

    /** Fetch `window` in full. `tickMs` is the minute it was asked in. */
    load(keys: readonly string[], window: LiveWindow, scope: ScopeOf, tickMs: number) {
      syncedTick = tickMs;
      let cancelled = false;
      setLoading(true);
      void fetchRows(keys, window, scope).then((answer) => {
        if (cancelled) return;
        setRows(answer);
        setLoading(false);
        // Landing is not a tick: the answer covers the minute it arrived in.
        syncedTick = deps.now();
      });
      return () => {
        cancelled = true;
      };
    },

    /**
     * The delta a still-running window needs at `tickMs`, merged into the rows
     * held — one window for every key, sized for the one that lags furthest.
     * Returns nothing when there is nothing to ask for, which is every minute a
     * window is already up to date: ~60 cards ask this once a minute.
     */
    append(keys: readonly string[], window: LiveWindow, scope: ScopeOf, tickMs: number) {
      if (loading) return undefined;
      const feeds = keys.map((key) => ({ key, rows: rows[key] ?? [], live: [] }));
      const delta = overlayDelta(feeds, window, tickMs, syncedTick);
      if (!delta) return undefined;
      syncedTick = tickMs;
      let cancelled = false;
      void fetchRows(keys, { ...delta, bucket: window.bucket }, scope).then((fresh) => {
        if (cancelled || keys.every((key) => (fresh[key] ?? []).length === 0)) return;
        setRows(
          Object.fromEntries(
            keys.map((key) => [key, mergeRollup(rows[key] ?? [], fresh[key] ?? [])]),
          ),
        );
      });
      return () => {
        cancelled = true;
      };
    },
  };
}
