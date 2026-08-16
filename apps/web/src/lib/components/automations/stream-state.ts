/**
 * What one automations frame does to the page's picture.
 *
 * The `automations` topic speaks two variants over one type: the frame the
 * server backfills on subscribe carries the whole decision ring in `history`,
 * every later frame carries only the tick's single `point`. Nothing on the wire
 * tags them, so {@link isSnapshotFrame} is the tag — and the two paths are
 * written out rather than left to a truthiness check, because an engine that
 * just restarted sends a snapshot with an *empty* ring and that is a ring, not
 * a missing one.
 *
 * Plain TS, no runes: this is the whole decision, and runes do not run under
 * `bun test` (see `apps/web/TESTING.md`). `stream.svelte.ts` is the reactive
 * shell that mirrors this state into `$state` and leases the topic.
 */

import type {
  AutomationStreamMessage,
  DecisionPoint,
  PeakShavingPlans,
  PeakShavingStatus,
} from "$lib/automations";

/**
 * Ring capacity, mirroring the server's `HISTORY_CAPACITY`. Held as a constant
 * rather than read from the wire: only `GET /api/automations/history` ever
 * declared it, and that poll is gone — the socket's snapshot is already capped
 * by the same number on the way out, so this only bounds the tick-by-tick
 * growth in between.
 */
// fallow-ignore-next-line unused-export -- the ring bound is the test's subject; nothing else needs it
export const HISTORY_CAPACITY = 2_880;

/** Everything the automations page paints from. */
export interface AutomationStreamState {
  status: PeakShavingStatus | null;
  /** Decision ring, oldest → newest — snapshot-seeded, then grown per tick. */
  history: DecisionPoint[];
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
  return {
    status: null,
    history: [],
    plan: null,
    tickMs: 30_000,
    tickArrivedAt: null,
    loaded: false,
  };
}

/** The subscribe-time frame — the one variant that carries the ring. */
export type AutomationSnapshotFrame = AutomationStreamMessage & { history: DecisionPoint[] };

/**
 * Is this the backfill frame? An array — even an empty one — is a ring the
 * server is handing over; `undefined` is a per-tick frame that says nothing
 * about the ring.
 */
// fallow-ignore-next-line unused-export -- exported for its own test: which variant a frame is, is the thing worth proving
export function isSnapshotFrame(frame: AutomationStreamMessage): frame is AutomationSnapshotFrame {
  return Array.isArray(frame.history);
}

/** Append one decision, dropping the duplicate of a point the ring already ends on. */
function appendPoint(history: DecisionPoint[], point: DecisionPoint | null): DecisionPoint[] {
  // The dedupe is what makes subscribe-time backfill safe: the server promotes
  // the topic to the live fan-out right after sending the snapshot, so the tick
  // that produced the ring's last point can be replayed immediately behind it.
  if (!point || point.t === history.at(-1)?.t) return history;
  return [...history.slice(-(HISTORY_CAPACITY - 1)), point];
}

/** The ring after this frame: replaced wholesale by a snapshot, grown by a tick. */
function nextHistory(
  state: AutomationStreamState,
  frame: AutomationStreamMessage,
): DecisionPoint[] {
  const base = isSnapshotFrame(frame) ? frame.history.slice(-HISTORY_CAPACITY) : state.history;
  return appendPoint(base, frame.point);
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
    history: nextHistory(state, frame),
    plan: frame.plan,
    tickMs: frame.tickMs,
    tickArrivedAt: freshTick ? arrivedAt : state.tickArrivedAt,
    loaded: true,
  };
}
