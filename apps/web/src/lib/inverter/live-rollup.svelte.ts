/**
 * The reactive shell over `./live-rollup.ts`, shared by the metric card and the
 * overlay: two `$effect`s and a `$derived`, each reading exactly what it must.
 * What they read is the whole of the refetch-loop risk (PR #60, #216), so it is
 * spelled out once, here, instead of once per chart.
 */

import { untrack } from "svelte";
import { api } from "$lib/api";
import { liveClock } from "$lib/time/live-clock.svelte";
import {
  feedsFor,
  rollupFeed,
  type HeldRows,
  type RollupApi,
  type RollupFeed,
  type ScopeOf,
} from "./live-rollup";
import { fetchWindow, type LiveWindow } from "./live-tail";
import type { HistoryRange } from "./ranges";
import type { LivePoint } from "./types";

const edenRollup: RollupApi = {
  rollup: (query) => api.api.history.rollup.get({ query }),
};

export type LiveRollup = {
  /** Per key, in `keys` order. Re-derived on a new answer and on the minute
   *  tick of a live range — never per frame. */
  readonly feeds: readonly RollupFeed[];
  /** The window's query is in flight (true until it first lands). */
  readonly loading: boolean;
  /** The window being filled, as `./live-tail` takes it. */
  readonly span: LiveWindow;
};

export type LiveRollupInputs = {
  keys: () => readonly string[];
  range: () => HistoryRange;
  /** The source a read is made under — `() => ({})` for a plant-wide read, or one per key. */
  scope: () => ScopeOf;
  /** Gates the fetch: a lazily-mounted card fetches nothing until it is near
   *  the viewport. `() => true` for a chart that is always drawn. */
  enabled: () => boolean;
};

/**
 * The two effects. What each one reads is the whole of the refetch-loop risk,
 * so read the comments before adding a dependency to either.
 */
function wire(
  feed: ReturnType<typeof rollupFeed>,
  input: LiveRollupInputs,
  span: () => LiveWindow,
) {
  // The window, in full, whenever the keys, the range or the source move.
  // The clock is read UNTRACKED: a tracked read here would refetch the whole
  // window every minute.
  $effect(() => {
    if (!input.enabled()) return;
    const tick = untrack(() => liveClock.now.getTime());
    return feed.load([...input.keys()], span(), input.scope(), tick);
  });

  // The delta, once per minute tick. `liveClock` is the TICK and never the
  // window: re-deriving `range` from it is the PR #60 refetch loop. The rows
  // are the feed's own, not `$state` read here, so landing a delta cannot
  // re-run the effect that asked for it — and `feed.append` refuses while the
  // window is still loading.
  $effect(() => {
    if (!input.enabled() || !input.range().live) return;
    const tick = liveClock.now.getTime();
    return feed.append([...input.keys()], span(), input.scope(), tick);
  });
}

/**
 * Hold `keys` over `range` and keep a live range growing towards the clock.
 * `live` reads a key's frame buffer, which is only ever read untracked.
 */
export function liveRollup(
  input: LiveRollupInputs & { live: (key: string) => readonly LivePoint[] },
): LiveRollup {
  let rows = $state.raw<HeldRows>({});
  let loading = $state(true);
  const feed = rollupFeed({
    api: edenRollup,
    now: () => liveClock.now.getTime(),
    onRows: (next) => (rows = next),
    onLoading: (next) => (loading = next),
  });

  const span = $derived(fetchWindow(input.range()));
  wire(feed, input, () => span);

  // Live frames past each key's last fetched bucket, so the line reaches the
  // present between deltas even while the server's continuous aggregate lags.
  // Keyed on the minute tick and on `rows`, with the buffers read UNTRACKED:
  // re-deriving a day of points on every ~1 Hz frame is the cost the lazy-mount
  // queue exists to avoid.
  const feeds = $derived.by(() => {
    const held = rows;
    const isLive = input.range().live;
    if (isLive) void liveClock.now;
    return untrack(() => feedsFor(input.keys(), held, isLive ? input.live : null));
  });

  return {
    get feeds() {
      return feeds;
    },
    get loading() {
      return loading;
    },
    get span() {
      return span;
    },
  };
}
