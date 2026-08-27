/**
 * Backfill-before-live ordering for one topic on one connection.
 *
 * Subscribing to a live feed is two things that must not race: "send me what
 * the state is now" and "send me every change from now on". The five original
 * WebSocket routes did them in the wrong order — `/ws/statistics` called
 * `ws.subscribe(...)` and only then awaited `todayStatistics(profile)`, so a
 * tick landing during that query overtook the snapshot and was immediately
 * overwritten by older data. `/ws/automations` had the same shape.
 *
 * The fix is a state, not a statement order. A topic is **priming** from the
 * moment it is requested until its snapshot has been sent: live payloads in
 * that window are buffered on the connection, and only once the snapshot and
 * the buffer have been written is the connection promoted to the shared pub/sub
 * fan-out. Every collaborator is a hook, so the rule is a pure function that
 * can be tested exhaustively rather than three lines inside an `open` handler.
 *
 * A priming run is also *bounded* in all three directions it can run away in:
 * it can be abandoned by the connection (a close), it gives up on a snapshot
 * that never settles, and its buffer has a ceiling. Each of those is a listener
 * that would otherwise stay attached to the bus with an array growing behind
 * it, per connection, for as long as the process lives.
 */

/** How a priming run ended. */
export type PrimeOutcome =
  /** The snapshot (if any) and the buffer went out; the topic is on the fan-out. */
  | "promoted"
  /** The topic was no longer wanted — unsubscribed, superseded, or the socket closed. */
  | "abandoned"
  /** Delivery failed: nothing was promoted, and the caller must drop the topic. */
  | "failed";

/** Default ceiling on live payloads held while a snapshot is read. */
const DEFAULT_PRIME_BUFFER_LIMIT = 512;

/**
 * The connection-side collaborators one priming run needs.
 *
 * `S` is the snapshot payload, `L` the live one. They differ for `logs`, where
 * the snapshot is the ring buffer (`LogEntry[]`) and a live payload is a single
 * entry off the bus.
 */
export interface PrimeHooks<S, L> {
  /**
   * Attach a live listener for the priming window; the returned function
   * detaches it. Optional: a topic whose snapshot is synchronous has no window
   * for a frame to slip through, and buffering it would only risk duplicating
   * whatever the snapshot already contains.
   */
  listen?: (handler: (payload: L) => void) => () => void;
  /** Read the current state. `undefined`/`null` means there is nothing to send. */
  snapshot: () => S | null | undefined | Promise<S | null | undefined>;
  /** Write the snapshot frame to the client. */
  sendSnapshot: (snapshot: S) => void;
  /** Write one buffered live frame to the client. */
  sendLive: (payload: L) => void;
  /** Hand this topic over to the shared pub/sub fan-out. */
  promote: () => void;
  /**
   * Whether this run is still the current one for a topic the connection still
   * wants. Re-checked after the await, and it must answer more than "is the
   * topic subscribed": `sub → unsub → sub` starts a second run while the first
   * is still in flight, and the slow first one must not deliver its stale
   * snapshot on top of the fresh one. The caller pairs the subscription check
   * with a generation token for exactly that.
   */
  isActive: () => boolean;
  /**
   * Receives a function that abandons this run: it detaches the live listener,
   * drops the buffer, and guarantees no further frame is written. Called once,
   * synchronously, before the snapshot is read — the connection registers it so
   * `close` can stop every in-flight prime instead of waiting for a query that
   * may never return.
   */
  onAbandon?: (abandon: () => void) => void;
  /**
   * How long the snapshot may take before the run gives up on it and goes live
   * anyway. Omitted means "wait forever", which is only safe when the caller
   * abandons the run some other way.
   */
  timeoutMs?: number;
  /** Ceiling on buffered live payloads. Defaults to {@link DEFAULT_PRIME_BUFFER_LIMIT}. */
  bufferLimit?: number;
}

/** Marks a snapshot that did not arrive in time; distinct from a `null` snapshot. */
const TIMED_OUT = Symbol("prime-timed-out");

/**
 * Read the backfill, bounded by {@link PrimeHooks.timeoutMs}.
 *
 * Every failure mode collapses to `undefined` — "there is nothing to backfill".
 * A snapshot that threw or never arrived costs the client its first paint, but
 * it must not also cost it the live feed: a dead panel until reload is worse
 * than a panel that fills on the next tick.
 */
async function readSnapshot<S>(hooks: Pick<PrimeHooks<S, never>, "snapshot" | "timeoutMs">) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = Promise.resolve(hooks.snapshot());
    if (hooks.timeoutMs === undefined) return await read;
    const result = await Promise.race([
      read,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), hooks.timeoutMs);
      }),
    ]);
    return result === TIMED_OUT ? undefined : result;
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Run the priming handshake for one topic on one connection. */
export async function primeTopic<S, L>(hooks: PrimeHooks<S, L>): Promise<PrimeOutcome> {
  const limit = hooks.bufferLimit ?? DEFAULT_PRIME_BUFFER_LIMIT;
  let buffered: L[] = [];
  let abandoned = false;

  let detach = hooks.listen?.((payload) => {
    buffered.push(payload);
    // Oldest first: these are successive states of the same live feed, so when
    // the window overruns, the newest payloads are the ones worth keeping —
    // and an unbounded array behind a stalled query is how one slow statistics
    // request turns into a per-connection memory leak.
    if (buffered.length > limit) buffered.shift();
  });
  /** Idempotent: `abandon` and the normal path both run it, whichever is first. */
  const detachOnce = () => {
    const detachment = detach;
    detach = undefined;
    detachment?.();
  };

  hooks.onAbandon?.(() => {
    abandoned = true;
    buffered = [];
    detachOnce();
  });

  const snapshot = await readSnapshot(hooks);

  try {
    if (abandoned || !hooks.isActive()) return "abandoned";
    if (snapshot !== undefined && snapshot !== null) hooks.sendSnapshot(snapshot);
    for (const payload of buffered) hooks.sendLive(payload);
    hooks.promote();
    return "promoted";
  } catch {
    // `ws.send` on a socket that closed mid-prime, or a payload that will not
    // serialise. Reported rather than thrown: the caller fire-and-forgets this
    // promise, so a rejection would be an unhandled one — and the topic never
    // promoted, so the caller has to drop it from the connection's state or a
    // re-`sub` is filtered out as "already subscribed" and never delivers.
    return "failed";
  } finally {
    // Detached in the same synchronous block as `promote`, so no emit can land
    // between the two and be delivered twice (buffered *and* by pub/sub) or
    // not at all.
    detachOnce();
  }
}
