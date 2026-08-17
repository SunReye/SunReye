/**
 * An admission queue for expensive mounts, so a scroll sweep does not pay for
 * the cards it merely passes.
 *
 * /history wired its intersection observer straight into `visible = true`. That
 * is synchronous: a 12s sweep built a LayerChart for all 59 cards it flew past
 * and tore all 59 back down — ~278ms of construction each on a preset range,
 * 9.4s blocked out of 12s, 10.6fps on the tablet.
 *
 * A card scrolled past is not a card being looked at. So an entering card only
 * REQUESTS its mount; the request is admitted once the scroll has been quiet for
 * `quietMs`, at most `perFrame` per frame so a settle never lands as one long
 * task. A card that leaves before it is admitted is CANCELLED and never builds
 * at all — that is where the win is; the frame budget is the polish.
 *
 * Every dependency is injected (`now`, `raf`, `cancelRaf`) because rune shells
 * cannot run under `bun test` (apps/web/TESTING.md). This module holds no DOM
 * and no Svelte, so the behaviour is provable with a hand-cranked clock.
 */

export type MountQueueDeps = {
  now?: () => number;
  raf?: (callback: () => void) => number;
  cancelRaf?: (handle: number) => void;
  /** How long the scroll must be still before anything is admitted. */
  quietMs?: number;
  /** How many mounts one frame may pay for. */
  perFrame?: number;
};

export type MountQueue = {
  /** Ask for `run` to happen once the page settles. Re-requesting a parked id
   *  replaces its callback and keeps its place in line. */
  request: (id: string, run: () => void) => void;
  /** Drop a still-parked request. Already-run and unknown ids are a no-op. */
  cancel: (id: string) => void;
  /** Tell the queue the page just moved. */
  noteScroll: () => void;
};

// fallow-ignore-next-line unused-export -- the injectable factory, exercised directly by mount-queue.test.ts; sharedMountQueue is the app's only call site and testing through it would need a browser
export function createMountQueue({
  now = () => performance.now(),
  // Wrapped, not referenced: the browser globals must be looked up when a
  // frame is actually scheduled, so constructing a queue costs nothing and
  // stays possible outside a browser.
  raf = (callback) => requestAnimationFrame(callback),
  cancelRaf = (handle) => cancelAnimationFrame(handle),
  quietMs = 160,
  perFrame = 1,
}: MountQueueDeps = {}): MountQueue {
  // Insertion-ordered by construction: a Map preserves first-set order, and
  // re-setting an existing key does NOT move it to the end — which is exactly
  // the "keeps its place in line" behaviour a jittery observer needs.
  const parked = new Map<string, () => void>();
  // Never scrolled reads as "settled long ago", so first paint admits on the
  // first frame instead of waiting out a quiet window for a scroll that never
  // happened.
  let lastScrollAt = Number.NEGATIVE_INFINITY;
  let frame: number | null = null;

  const settled = () => now() - lastScrollAt >= quietMs;

  const schedule = () => {
    if (frame === null && parked.size > 0) frame = raf(drain);
  };

  function drain() {
    frame = null;
    for (let admitted = 0; admitted < perFrame; admitted++) {
      // Re-checked per admission, not once per frame: a callback (or a scroll
      // event landing between them) must be able to stop the rest of the budget.
      if (!settled()) break;
      const next = parked.entries().next();
      if (next.done) break;
      const [id, run] = next.value;
      parked.delete(id);
      run();
    }
    schedule();
  }

  return {
    request(id, run) {
      parked.set(id, run);
      schedule();
    },
    cancel(id) {
      parked.delete(id);
      if (parked.size === 0 && frame !== null) {
        cancelRaf(frame);
        frame = null;
      }
    },
    noteScroll() {
      lastScrollAt = now();
      schedule();
    },
  };
}

/**
 * The one queue the history grid shares.
 *
 * Per-card queues would each hold their own `perFrame` budget, which is no
 * budget at all: 63 cards entering together would admit 63 mounts in one frame,
 * the exact long task this module exists to break up. The scroll listener is
 * capture-phase on the window because the page scrolls inside `main`, not on the
 * window itself, and scroll does not bubble.
 */
let shared: MountQueue | null = null;

export function sharedMountQueue(): MountQueue {
  if (shared) return shared;
  // 400ms, not the module's 160ms default. A wheel notch or a touch flick
  // repeats about every 250ms, so a 160ms window treats the gap BETWEEN two
  // flicks of one continuous gesture as "the reader has stopped" and admits a
  // mount into it — and a chart build is ~278ms on a preset range, so the next
  // flick lands in the middle of one. Measured across a 12s sweep: 36 mounts at
  // 160ms against 44 unqueued, versus 8 at 400ms. The cost is that a chart
  // appears 400ms after you actually stop, which the skeleton already covers.
  const queue = createMountQueue({ quietMs: 400 });
  shared = queue;
  addEventListener("scroll", queue.noteScroll, { capture: true, passive: true });
  return queue;
}
