/**
 * The measuring instruments.
 *
 * Every in-page probe lives here, in one injected script, so a spec never
 * writes `page.evaluate` of its own and two specs can never disagree about what
 * "a long task" or "a chart mount" means.
 *
 * Definitions, stated once:
 *   - **fps**       — rAF callbacks per second over the measured window. The
 *                     browser's own frame clock, not a guess from timers.
 *   - **longTasks** — `PerformanceObserver('longtask')` entries: main-thread
 *                     work over 50 ms, i.e. a frame the user felt.
 *   - **blockedMs** — the SUM of those entries' durations. Not "minus 50 each":
 *                     the measured baselines (≈4.5 s of a 12 s scroll on the
 *                     live range, ≈9.4 s on a preset range) are total long-task
 *                     time, and a helper that redefined it would make every
 *                     recorded number unusable.
 *   - **maxFrameMs**— the longest gap between two consecutive rAF callbacks.
 *   - **a chart mount** — a `.lc-root-container` entering the DOM. That is
 *                     layerchart's own root element, so it counts real chart
 *                     construction rather than a component wrapper.
 *   - **a text mutation** — a `characterData` change. Live readouts repaint
 *                     through text nodes, so this is the readout-storm probe
 *                     (measured: 829 per 10 s on /history, 78 on /).
 *
 * ## Read these numbers as ratios, not as absolutes
 *
 * The instrument is faithful: `/` idles at 59.8 fps with zero long tasks here,
 * against 59.9 fps measured on the real tablet. But a chart-heavy page is not
 * comparable across machines — this browser composites in software, so building
 * sixty SVG charts costs more here than it does on a GPU, and /history scores
 * below its production figure while showing exactly the same phenomena in the
 * same order (overview ≫ live range ≫ preset range).
 *
 * So an absolute fps floor pinned to a number from one laptop is a flake waiting
 * for a new CI runner — and now also for a new worker, since the suite runs
 * parallel and sharded. The timing helpers below are kept for local
 * investigation; no spec asserts on their numbers any more. The COUNTING helpers
 * (requests, mounts, mutations) are contention-independent and are what the
 * specs use.
 *
 * `blockedMs` also under-reports on purpose: `longtask` only sees work over
 * 50 ms, and a page that spends 40 ms per frame is ruinous with zero long
 * tasks. `fps` and `maxFrameMs` are what catch that.
 */

import type { CDPSession, Page } from "@playwright/test";

/** Stable selectors for the things the perf specs point at. */
export const SELECTORS = {
  /** layerchart's root element — one per mounted chart. */
  chart: ".lc-root-container",
  /**
   * One metric card's plot box. `entity-history-card.svelte` renders either the
   * skeleton or the plot wrapper at exactly this size, so it counts cards
   * whether or not they have mounted.
   */
  metricCard: ".h-50.w-full",
  /** The app shell's scroll container (`(app)/+layout.svelte`). */
  scroller: "main",
  /**
   * A live numeric readout — a power-flow node or the hub's pill on the
   * overview, a row inside a node's detail dialog.
   * `power-flow-node.svelte` renders a literal `\u2014` here while the value is
   * `undefined`, so "does this hold a digit?" is the readout probe the
   * shell-lease outage was reported as.
   */
  liveReadout: "span.font-semibold.tabular-nums",
} as const;

export interface ScrollOptions {
  /** How long to sweep. The measured baselines are 12 s runs. */
  seconds?: number;
  /** Wheel delta per step, as a fraction of the viewport height. */
  stepFraction?: number;
  /** How long `stepFraction` of a viewport should take to travel. */
  intervalMs?: number;
  /**
   * Hold still for this long after each `stepFraction` of travel, modelling a
   * reader who scrolls, stops to look, and scrolls on.
   *
   * Leave at 0 for a FLICK — a continuous gesture, where nothing should build
   * because the reader has not stopped anywhere. Set it above the mount queue's
   * settle window (400 ms) for a DWELL, where charts SHOULD build: that is the
   * reader asking for them, and it is the gesture to measure per-mount cost on.
   * The two gestures test opposite halves of the same feature, so a suite needs
   * both.
   */
  dwellMs?: number;
}

export interface ScrollMetrics {
  fps: number;
  longTasks: number;
  blockedMs: number;
  maxFrameMs: number;
  /** Wall time actually measured, in ms. */
  durationMs: number;
}

export interface FullMetrics extends ScrollMetrics {
  chartMounts: number;
  chartUnmounts: number;
  textMutations: number;
}

interface RawProbe {
  frames: number;
  firstFrame: number;
  lastFrame: number;
  maxFrameMs: number;
  longTasks: number;
  blockedMs: number;
  chartMounts: number;
  chartUnmounts: number;
  textMutations: number;
  durationMs: number;
}

/**
 * Installed into the page as a string so it can be started and stopped from
 * separate round trips.
 *
 * Probe sessions NEST. `countChartMounts(page, () => measureScroll(page, …))`
 * is the obvious way to ask "how many charts did that sweep build?", and a
 * single global counter would have the inner helper tear the outer one down
 * mid-flight. So the observers are shared — one rAF loop, one
 * PerformanceObserver, one MutationObserver, however many sessions — and each
 * session only carries its own tallies.
 */
const PROBE_SOURCE = String.raw`
(() => {
  const SEL = '.lc-root-container';
  const w = window;
  if (w.__sunreyePerf) return;
  const sessions = new Map();
  let nextId = 1;
  let shared = null;

  const each = (fn) => { for (const s of sessions.values()) fn(s); };

  function attach() {
    if (shared) return;
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) each((s) => { s.longTasks++; s.blockedMs += e.duration; });
    });
    try { po.observe({ entryTypes: ['longtask'] }); } catch (err) { /* unsupported */ }
    let raf = 0;
    const tick = (t) => {
      each((s) => {
        if (s.frames === 0) s.firstFrame = t;
        else { const d = t - s.prevFrame; if (d > s.maxFrameMs) s.maxFrameMs = d; }
        s.prevFrame = t; s.lastFrame = t; s.frames++;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const countIn = (node) => (node.matches(SEL) ? 1 : 0) + node.querySelectorAll(SEL).length;
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') { each((s) => s.textMutations++); continue; }
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          const c = countIn(n); if (c) each((s) => { s.chartMounts += c; });
        }
        for (const n of r.removedNodes) {
          if (n.nodeType !== 1) continue;
          const c = countIn(n); if (c) each((s) => { s.chartUnmounts += c; });
        }
      }
    });
    mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    shared = () => { po.disconnect(); mo.disconnect(); cancelAnimationFrame(raf); };
  }

  w.__sunreyePerf = {
    start() {
      attach();
      const id = nextId++;
      sessions.set(id, {
        t0: performance.now(),
        frames: 0, firstFrame: 0, lastFrame: 0, prevFrame: 0, maxFrameMs: 0,
        longTasks: 0, blockedMs: 0, chartMounts: 0, chartUnmounts: 0, textMutations: 0,
      });
      return id;
    },
    stop(id) {
      const s = sessions.get(id);
      if (!s) throw new Error('perf probe session ' + id + ' was never started');
      sessions.delete(id);
      if (sessions.size === 0 && shared) { shared(); shared = null; }
      return {
        frames: s.frames, firstFrame: s.firstFrame, lastFrame: s.lastFrame,
        maxFrameMs: s.maxFrameMs, longTasks: s.longTasks, blockedMs: s.blockedMs,
        chartMounts: s.chartMounts, chartUnmounts: s.chartUnmounts,
        textMutations: s.textMutations, durationMs: performance.now() - s.t0,
      };
    },
  };
})()
`;

/**
 * Start a probe session and return its handle. Sessions nest, so a helper may
 * be called inside another helper's `during` callback.
 */
export async function startProbe(page: Page): Promise<number> {
  await page.evaluate(PROBE_SOURCE);
  return (await page.evaluate("window.__sunreyePerf.start()")) as number;
}

/** Close a session and read its counters back. */
export async function stopProbe(page: Page, id: number): Promise<RawProbe> {
  return (await page.evaluate(`window.__sunreyePerf.stop(${id})`)) as RawProbe;
}

function toMetrics(raw: RawProbe): FullMetrics {
  const spanMs = Math.max(1, raw.lastFrame - raw.firstFrame);
  return {
    fps: raw.frames > 1 ? round((raw.frames - 1) / (spanMs / 1000)) : 0,
    longTasks: raw.longTasks,
    blockedMs: Math.round(raw.blockedMs),
    maxFrameMs: round(raw.maxFrameMs),
    durationMs: Math.round(raw.durationMs),
    chartMounts: raw.chartMounts,
    chartUnmounts: raw.chartUnmounts,
    textMutations: raw.textMutations,
  };
}

const round = (n: number): number => Math.round(n * 10) / 10;

/**
 * How many requests matching `urlPattern` the page makes while `during` runs.
 *
 * This is the probe for the outage a source-text regex test used to stand in
 * for: the shell's `$effect` took a dependency on the map its own backfill
 * wrote, and re-leased the socket about twelve times a second. `/api/profile`
 * refetched in a loop. On healthy code this returns 0 on a settled page.
 *
 * `urlPattern` is a substring when a string, or a regex tested against the full
 * URL.
 */
export async function countRequests(
  page: Page,
  urlPattern: string | RegExp,
  during: () => Promise<unknown>,
): Promise<number> {
  let count = 0;
  const matches = (url: string): boolean =>
    typeof urlPattern === "string" ? url.includes(urlPattern) : urlPattern.test(url);
  const onRequest = (request: { url(): string }): void => {
    if (matches(request.url())) count += 1;
  };
  page.on("request", onRequest);
  try {
    await during();
  } finally {
    page.off("request", onRequest);
  }
  return count;
}

/** Charts that entered the DOM while `during` ran. */
export async function countChartMounts(
  page: Page,
  during: () => Promise<unknown>,
): Promise<number> {
  return (await countChartLifecycle(page, during)).mounts;
}

/**
 * Charts in AND out. Both halves matter: a scroll that mounts sixty charts and
 * unmounts sixty is paying full construction for every card it passes, which is
 * a different defect from one that mounts sixty and keeps them.
 */
export async function countChartLifecycle(
  page: Page,
  during: () => Promise<unknown>,
): Promise<{ mounts: number; unmounts: number }> {
  const id = await startProbe(page);
  await during();
  const raw = await stopProbe(page, id);
  return { mounts: raw.chartMounts, unmounts: raw.chartUnmounts };
}

/** `characterData` mutations while `during` runs — the live-readout repaint probe. */
export async function countTextMutations(
  page: Page,
  during: () => Promise<unknown>,
): Promise<number> {
  const id = await startProbe(page);
  await during();
  return (await stopProbe(page, id)).textMutations;
}

/** Wheel-scroll the app shell for `seconds`, bouncing at both ends of the page. */
export async function scrollPage(page: Page, options: ScrollOptions = {}): Promise<void> {
  const seconds = options.seconds ?? 12;
  const stepFraction = options.stepFraction ?? 0.5;
  const intervalMs = options.intervalMs ?? 250;
  const viewport = page.viewportSize();
  const height = viewport?.height ?? 768;
  const step = Math.round(height * stepFraction);

  // The ENTIRE gesture runs inside the page, in one evaluate. This is not a
  // style preference — it is what makes a throttled measurement mean anything.
  //
  // The first version of this helper drove the scroll from the test process:
  // `mouse.wheel`, `waitForTimeout`, then an `evaluate` to read the position,
  // three round trips per step. Measured under `throttleCpu(4)`, that produced
  // 13 scroll events in 12 s with a MEDIAN GAP OF 1100ms — not a scroll at all,
  // but thirteen jumps with a second of stillness between them. Anything that
  // reacts to the reader pausing (the mount queue settles after 400ms) is
  // correct to treat each of those stops as "the reader stopped here and wants
  // to look", so it mounted 64 charts and the budget failed against code that
  // was working. At 1x the same helper gave 129 events, an 84ms median gap, and
  // 0 mounts.
  //
  // Driven from inside the page, the gesture stays continuous at any throttle:
  // rAF still fires (slower), and no step waits on a round trip.
  await page.evaluate(
    async ({ selector, seconds, step, intervalMs, dwellMs }) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      const target: Element =
        el && el.scrollHeight > el.clientHeight + 1 ? el : document.scrollingElement!;
      // px per millisecond, so the sweep covers `step` px every `intervalMs`
      // whatever the frame rate turns out to be.
      const velocity = step / intervalMs;
      const deadline = performance.now() + seconds * 1000;
      let direction = 1;
      let last = performance.now();
      let travelled = 0;
      let restingUntil = 0;

      await new Promise<void>((resolve) => {
        const frame = (now: number) => {
          const dt = now - last;
          last = now;
          if (now >= deadline) return resolve();

          // Dwelling gesture: having covered `step` px, hold still for
          // `dwellMs` before moving again. Holding still is the POINT — it is
          // the reader stopping to look, which is when a chart should build.
          if (dwellMs > 0 && now < restingUntil) {
            requestAnimationFrame(frame);
            return;
          }

          const max = target.scrollHeight - target.clientHeight;
          const delta = velocity * dt * direction;
          let next = target.scrollTop + delta;
          // A 63-card page outlasts a 12 s sweep, but a shorter one does not:
          // turn around at the ends rather than measuring a stationary page.
          if (next >= max) {
            next = max;
            direction = -1;
          } else if (next <= 0) {
            next = 0;
            direction = 1;
          }
          target.scrollTop = next;

          if (dwellMs > 0) {
            travelled += Math.abs(delta);
            if (travelled >= step) {
              travelled = 0;
              restingUntil = now + dwellMs;
            }
          }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
    },
    { selector: SELECTORS.scroller, seconds, step, intervalMs, dwellMs: options.dwellMs ?? 0 },
  );
}

/**
 * Scroll and report frame health. The headline helper — the measured baselines
 * on a tablet profile with 4× CPU throttle are 37 fps on the live range and
 * 10.6 fps on "Last week".
 */
export async function measureScroll(
  page: Page,
  options: ScrollOptions = {},
): Promise<ScrollMetrics> {
  const id = await startProbe(page);
  await scrollPage(page, options);
  const full = toMetrics(await stopProbe(page, id));
  return {
    fps: full.fps,
    longTasks: full.longTasks,
    blockedMs: full.blockedMs,
    maxFrameMs: full.maxFrameMs,
    durationMs: full.durationMs,
  };
}

/**
 * One sweep, every number. Prefer this when a spec wants both frame health and
 * mount counts — two passes cost two sweeps and cannot be compared, because the
 * second starts with the first one's charts already built.
 */
export async function scrollAndMeasure(
  page: Page,
  options: ScrollOptions = {},
): Promise<FullMetrics> {
  const id = await startProbe(page);
  await scrollPage(page, options);
  return toMetrics(await stopProbe(page, id));
}

/**
 * Slow the main thread down by `rate`×, the way the measured baselines were
 * taken (4× on a tablet profile). Returns the undo.
 */
export async function throttleCpu(page: Page, rate: number): Promise<() => Promise<void>> {
  const client: CDPSession = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate });
  return async () => {
    await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await client.detach();
  };
}

export interface MountCostOptions {
  /** How many scroll steps to take at most. */
  steps?: number;
  /** Travel per step, as a fraction of the viewport height. */
  stepFraction?: number;
  /** How long that travel takes. NOT measured — see {@link measureMountCost}. */
  travelMs?: number;
  /**
   * How long the page must go without a new chart appearing before the burst
   * counts as finished. Must exceed the mount queue's own settle window
   * (400 ms) or the measurement stops before the queue has started.
   */
  quietMs?: number;
  /** Give up waiting for quiet after this long, so a pathological build cannot hang the spec. */
  maxSettleMs?: number;
  /**
   * Grace period before closing the probe. `longtask` entries are delivered in
   * a later task, so a window closed the instant it goes quiet drops the tail
   * of the work it was measuring.
   */
  drainMs?: number;
}

export interface MountCost {
  /** Long-task time inside the stationary windows only. */
  blockedMs: number;
  chartMounts: number;
  longTasks: number;
  /** Windows actually measured (fewer than `steps` if the page ran out). */
  windows: number;
  /** Wall time spent inside the measured windows. */
  measuredMs: number;
}

/**
 * What mounting a chart costs, measured with the page HELD STILL.
 *
 * ## Why this exists, and why dividing a scroll sweep does not work
 *
 * The obvious instrument — sweep for 12 s, divide total long-task time by the
 * number of charts that appeared — does not measure a per-mount cost, because
 * the numerator is dominated by a term that has nothing to do with mounting.
 * Scrolling a stack of sixty cards re-layouts and repaints every chart already
 * on screen, and under a 4× throttle every one of those frames is a long task.
 * Fitting the measured runs gives `blocked ≈ 3600ms + ~100ms × mounts`: the
 * constant is the scroll, and a fixed-duration sweep pays it whatever happens.
 *
 * Dividing that by the mount count therefore reads `3600/mounts + 100`, which
 * is a hyperbola in the DENOMINATOR — and the denominator is exactly what a
 * slower machine changes, because fewer dwell cycles complete inside a fixed
 * 12 s. Measured on one unchanged tree, only the throttle varying:
 *
 * | throttle | mounts | blocked | blocked/mounts |
 * | -------- | ------ | ------- | -------------- |
 * | 4×       | 42     | 7489    | 178            |
 * | 6×       | 32     | 9144    | 286            |
 * | 8×       | 20     | 8494    | 425            |
 *
 * Same code, same page, a metric that more than doubles. That is how a 280 ms
 * budget failed on CI at 296–308 ms while reading 165 ms locally: CI is roughly
 * half this machine's speed, so it mounted about twenty charts and paid the
 * whole scroll constant across them. `corr(blocked/mounts, mounts) = -0.91`.
 *
 * ## What this measures instead
 *
 * The probe runs ONLY while the page is stationary. Each step scrolls
 * unmeasured, then holds still and measures until no new chart has appeared for
 * `quietMs`. A stationary page with its charts already built does almost no
 * work, so the constant term is gone and what is left in `blockedMs` is chart
 * construction — which makes `blockedMs / chartMounts` a real per-mount figure
 * that stays put when the mount count moves.
 *
 * Waiting for QUIET rather than a fixed dwell is what carries this across
 * machines: a slower runner takes longer to build its charts and is given that
 * time, instead of having the window close mid-build and reporting a mount whose
 * cost was never counted.
 */
export async function measureMountCost(
  page: Page,
  options: MountCostOptions = {},
): Promise<MountCost> {
  const steps = options.steps ?? 12;
  const stepFraction = options.stepFraction ?? 0.5;
  const travelMs = options.travelMs ?? 250;
  const quietMs = options.quietMs ?? 600;
  const maxSettleMs = options.maxSettleMs ?? 8000;
  const drainMs = options.drainMs ?? 200;
  const viewport = page.viewportSize();
  const height = viewport?.height ?? 768;
  const step = Math.round(height * stepFraction);

  await page.evaluate(PROBE_SOURCE);
  return (await page.evaluate(
    async (args) => {
      const perf = (
        window as unknown as {
          __sunreyePerf: {
            start(): number;
            stop(id: number): { blockedMs: number; chartMounts: number; longTasks: number };
          };
        }
      ).__sunreyePerf;
      const host = document.querySelector(args.selector) as HTMLElement | null;
      const target: Element =
        host && host.scrollHeight > host.clientHeight + 1 ? host : document.scrollingElement!;
      const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
      const built = (): number => document.querySelectorAll(args.chartSelector).length;

      // Scrolled on a rAF ramp rather than by one assignment: a single jump
      // lands the whole distance in one frame, which is not the gesture the
      // lazy-mount window reacts to. This travel is deliberately OUTSIDE every
      // probe session, so its layout and paint cost is never attributed to a
      // mount.
      const travel = (distance: number): Promise<void> =>
        new Promise((resolve) => {
          const from = target.scrollTop;
          const t0 = performance.now();
          const frame = (now: number): void => {
            const progress = Math.min(1, (now - t0) / args.travelMs);
            target.scrollTop = from + distance * progress;
            if (progress < 1) requestAnimationFrame(frame);
            else resolve();
          };
          requestAnimationFrame(frame);
        });

      let blockedMs = 0;
      let chartMounts = 0;
      let longTasks = 0;
      let windows = 0;
      let measuredMs = 0;

      for (let i = 0; i < args.steps; i++) {
        const room = target.scrollHeight - target.clientHeight - target.scrollTop;
        if (room <= 1) break;
        await travel(Math.min(args.step, room));

        const id = perf.start();
        const openedAt = performance.now();
        let seen = built();
        let quietSince = performance.now();
        // Hold still until the build burst this step queued has finished.
        while (
          performance.now() - quietSince < args.quietMs &&
          performance.now() - openedAt < args.maxSettleMs
        ) {
          await wait(100);
          const now = built();
          if (now !== seen) {
            seen = now;
            quietSince = performance.now();
          }
        }
        await wait(args.drainMs);
        const raw = perf.stop(id);
        measuredMs += performance.now() - openedAt;
        blockedMs += raw.blockedMs;
        chartMounts += raw.chartMounts;
        longTasks += raw.longTasks;
        windows++;
      }
      return { blockedMs, chartMounts, longTasks, windows, measuredMs };
    },
    {
      selector: SELECTORS.scroller,
      chartSelector: SELECTORS.chart,
      steps,
      step,
      travelMs,
      quietMs,
      maxSettleMs,
      drainMs,
    },
  )) as MountCost;
}

/**
 * The cost of building ONE chart, as a multiple of a fixed unit of this
 * machine's CPU work.
 *
 * Divided by {@link calibrateCpu} rather than left in milliseconds. Chart
 * construction is mostly d3 turning rows into path data, so a fixed arithmetic
 * loop measured under the SAME throttle is a fair yardstick, and dividing by it
 * cancels most of the machine out. That is the difference between a budget that
 * means "a chart costs this much work" and one that means "a chart costs this
 * many milliseconds on the laptop the number was written on": measured on one
 * unchanged tree, the raw figure runs 156 / 284 / 451 ms at 4x / 6x / 8x while
 * this ratio runs 0.32 / 0.40 / 0.45.
 *
 * ## Why the live feed is NOT subtracted
 *
 * The obvious next correction is to measure a still page building nothing and
 * take that off the numerator, since the feed keeps arriving throughout. It was
 * tried and removed: measured idle long-task time is 0.00 ms/ms at 4x and 6x and
 * 0.05 at 8x, so it corrects nothing in the range this spec runs in — and
 * because idle work grows with throttle while the window count does not, the
 * subtraction runs away at the extremes and INVERTS the metric. With it in, the
 * same healthy page read 0.16 at 12x and 0.002 at 16x, which is a spec that
 * passes hardest when the machine is worst. An over-report on a slow runner is a
 * safe failure; a silent pass is not.
 */
export function perMountCost(measured: MountCost, cpuUnitMs: number): number {
  return measured.blockedMs / measured.chartMounts / cpuUnitMs;
}

/**
 * How long this machine takes to do a fixed lump of arithmetic, in ms.
 *
 * The yardstick for {@link perMountCost}. Deterministic, allocation-free and
 * touching neither the DOM nor the network, so it measures CPU and nothing else;
 * run under whatever `throttleCpu` rate is in force and it tracks it almost
 * exactly (measured 486 / 730 / 974 ms at 4x / 6x / 8x, against an ideal
 * 486 / 729 / 972).
 *
 * The fastest of several passes, not the mean: a slow pass means something else
 * ran, and the floor is the number that describes the machine.
 */
export async function calibrateCpu(page: Page): Promise<number> {
  return (await page.evaluate(`(() => {
  const run = () => {
    const t0 = performance.now();
    let x = 1234567;
    let acc = 0;
    for (let i = 0; i < 6000000; i++) { x = (x * 1103515245 + 12345) % 2147483648; acc += x % 7; }
    // Returned so the loop cannot be optimised away as dead.
    return { ms: performance.now() - t0, acc };
  };
  run();
  return Math.min(run().ms, run().ms, run().ms);
})()`)) as number;
}
