/**
 * What one automations frame does to the page's picture.
 *
 * ONE VARIANT NOW. The topic used to speak two shapes over one type: the
 * subscribe-time frame carried a whole 2 880-point decision ring in `history`,
 * every later frame carried a single `point`, and nothing on the wire tagged
 * which was which — so this file held a sniffer, a ring bound, an append with a
 * dedupe, and a comment explaining that an empty ring is a ring and not a
 * missing one. All of it existed because the server's decision log was in
 * memory and the socket was the only way to see it.
 *
 * The optimizer is a device now: what each tick decided is a row in
 * `metrics_raw`, and the charts read it through `/api/history/rollup` like every
 * other series in the app. So this topic carries only the two things a
 * hypertable must never hold — LIVE ENGINE STATE (error strings, blockers, a
 * countdown) and a FORECAST — and folding a frame is an assignment.
 *
 * Plain TS, no runes: this is the whole decision, and runes do not run under
 * `bun test` (see `apps/web/TESTING.md`). `stream.svelte.ts` is the reactive
 * shell that mirrors this state into `$state` and leases the topic.
 */

import type {
  AutomationStreamMessage,
  PeakShavingPlans,
  PeakShavingStatus,
} from "$lib/automations";

/** Everything the automations page paints its LIVE half from. */
export interface AutomationStreamState {
  status: PeakShavingStatus | null;
  plan: PeakShavingPlans | null;
  /** Engine cadence, ms — the countdown base for "next decision in …". */
  tickMs: number;
  /**
   * Client-clock arrival of the frame that carried the newest tick — the
   * countdown anchor. Deliberately not the server's `lastTickAt`: the viewer's
   * clock and the server's can disagree, and a skew larger than the interval
   * would pin the countdown at 0.
   */
  tickArrivedAt: number | null;
  /** True once a first frame has arrived — before that the page is loading. */
  loaded: boolean;
}

export function emptyAutomationStream(): AutomationStreamState {
  return { status: null, plan: null, tickMs: 30_000, tickArrivedAt: null, loaded: false };
}

/**
 * Fold one frame into the page's picture. `arrivedAt` is the client clock at
 * delivery, injected so the countdown anchor is provable.
 */
export function applyAutomationFrame(
  state: AutomationStreamState,
  frame: AutomationStreamMessage,
  arrivedAt: number,
): AutomationStreamState {
  // Re-anchor only on a tick that actually happened *and* is new: an engine
  // that has never run reports `null`, and a countdown from nothing counts
  // down to nothing.
  const freshTick =
    frame.status.lastTickAt !== null && frame.status.lastTickAt !== state.status?.lastTickAt;
  return {
    status: frame.status,
    plan: frame.plan,
    tickMs: frame.tickMs,
    tickArrivedAt: freshTick ? arrivedAt : state.tickArrivedAt,
    loaded: true,
  };
}

/**
 * WHERE "THERE IS A NEW DECISION TO FETCH" IS ANSWERED, and why it is not here.
 *
 * The frame no longer carries the decision itself, so the charts re-read the
 * optimizer's stored series when the engine's own `status.lastTickAt` moves. The
 * cue is therefore the STAMP, handed down as a prop and read by the effect that
 * fetches — not a signal, and not a flag latched here.
 *
 * That matters for one reason: the socket replays its snapshot on every
 * (re)subscribe. A latched flag would refetch five series on each reconnect; a
 * stamp that has not moved re-runs no effect at all. `e2e/optimizer-history.spec.ts`
 * is what proves it, because "how many requests did that frame cost" only exists
 * in a running document.
 */
