/**
 * The app's shared, TICKING "now".
 *
 * `new Date()` read once is a bug with a delay on it. A `$props()` default is
 * evaluated once and cached, and a page that resolves its opening window from
 * `new Date()` at init never reads the clock again — so a dashboard left open
 * past midnight kept saying "Today ● Live" while standing on yesterday, with the
 * forward arrow (this design's ONLY live indicator) dead. Anything that renders
 * a judgement about the present has to re-read the clock.
 *
 * THE TICK IS THE LIVE FEED, not a timer. `inverter.latest` is written by every
 * frame on the `metrics` topic, which the app shell leases on every `(app)`
 * route — so a clock keyed off it costs one `$derived` recomputation per frame
 * the page was already handling, and no interval that has to be started, stopped
 * and leased. `bus.connected` is in the dependency set too: a reconnect is a
 * moment where the world may have moved on while nothing was arriving.
 *
 * `clockTick` coarsens the result to a minute so the ~1 Hz feed cannot propagate
 * as ~1 Hz re-renders. A derived whose value did not change stops there, so
 * consumers of this clock re-evaluate once a minute — never per frame, and never
 * on the chart layer, which reads its window from the page's `range` and not
 * from here. That separation is deliberate: `range` is what ~60 metric cards
 * fetch and draw, and re-deriving it on a clock tick is the exact shape of the
 * PR #60 reactive loop.
 *
 * KNOWN LIMIT: with the socket down there are no frames, so the clock stops
 * advancing until it comes back. That is the state where every reading on the
 * page is already an em dash, and it is a much smaller lie than a timer nobody
 * leases; a page that reconnects gets a tick from `bus.connected` immediately.
 */

import { inverter } from "$lib/inverter/store.svelte";
import { bus } from "$lib/ws/bus.svelte";
import { clockTick } from "./live-clock";

class LiveClock {
  /** Coarse wall clock (ms), recomputed on a live frame or a reconnect. */
  #tick = $derived.by(() => {
    void inverter.latest;
    void bus.connected;
    return clockTick(Date.now());
  });

  /**
   * Now, to the minute. Read it inside a `$derived` or a template and that
   * consumer re-runs when the minute turns.
   */
  get now(): Date {
    return new Date(this.#tick);
  }
}

export const liveClock = new LiveClock();
