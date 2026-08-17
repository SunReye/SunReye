/**
 * The scroll sweep, measured end to end in a real browser.
 *
 * Baseline on the tablet profile (dpr 2, 4x CPU throttle) before this change:
 *   /history · "Last week" · 12s sweep → 10.6fps, 34 long tasks, 9452ms blocked,
 *   and 59 chart mounts AND 59 unmounts — one full LayerChart construction for
 *   every one of the 63 cards the sweep passed, at ~278ms each.
 *
 * Two things fix that. The mount queue admits a card only once the scroll has
 * gone quiet, and CANCELS a card that leaves before it was admitted — so a
 * gesture that flies past a card never builds it. The retention band mounts on
 * a 250px margin but releases only outside 1500px, so a nudge does not tear
 * down what you just stopped at.
 *
 * ## Pacing matters, and these specs are explicit about it
 *
 * `scrollPage` does a `page.evaluate` round trip between wheel steps, and under
 * a 4x CPU throttle that round trip costs hundreds of milliseconds. So the
 * harness's DEFAULT `intervalMs: 250` is not a continuous gesture at all — it is
 * "half a screen, stand still for half a second, repeat", and a queue that waits
 * for the scroll to settle is RIGHT to admit a mount into each of those stops.
 * Measured on that pacing: 44 mounts unqueued against 38 queued, which says
 * almost nothing about the fix.
 *
 * A real flick or a momentum scroll fires `scroll` every frame. `intervalMs: 40`
 * is the harness's closest honest imitation, and it is what these specs use.
 *
 * Read the rest as RATIOS. This browser composites in software, so a chart-heavy
 * page scores below its production figure while showing the same ordering.
 */

import { expect, test } from "@playwright/test";
import { CHARTABLE_METRIC_COUNT } from "./support/api-mock";
import { metricCards, mountedCharts, openHistory, selectRange } from "./support/history";
import { countChartMounts, scrollAndMeasure, scrollPage, throttleCpu } from "./support/perf";

/** A continuous gesture: a step every 40ms, so the scroll never goes quiet. */
const FLICK = { seconds: 12, stepFraction: 0.5, intervalMs: 40 } as const;

test("a preset-range sweep does not build a chart for every card it passes", async ({ page }) => {
  const backend = await openHistory(page);
  await selectRange(page, "Last week");
  await expect(metricCards(page)).toHaveCount(CHARTABLE_METRIC_COUNT);

  backend.resetRequests();
  const restore = await throttleCpu(page, 4);
  const result = await scrollAndMeasure(page, FLICK);
  await restore();

  // The headline. The budget sits far above the measured figure and still an
  // order of magnitude below the 63 cards the sweep travels over — which is
  // what "one build per card passed" would put here.
  expect(result.chartMounts).toBeLessThan(12);
  expect(result.chartUnmounts).toBeLessThan(12);
  // And the sweep did not merely move the cost: the rollup fetch is per built
  // chart, so 63 refetches would show up here even if the mounts did not.
  expect(backend.requestCount("/api/history/rollup")).toBeLessThan(15);
  expect(backend.unhandled).toEqual([]);
});

test("the live range pays the same per-sweep mount cost as a preset one", async ({ page }) => {
  // The live range measured 4459-4950ms blocked out of 12s on the tablet, and
  // it has TWO causes: the mounts this change removes, and what the mounted
  // live charts then spend per frame. The second is a different fix in a
  // different file, and its residue is noisy (6.5s on one run here, 3.4s on the
  // next), so this case deliberately does not put a budget on `blockedMs` —
  // pinning a number this change does not control is how a suite starts
  // flaking. What it does pin is the term that IS this change's: mounts, and
  // the worst single frame, which is what a synchronous chart build looks like.
  const backend = await openHistory(page);
  await expect(metricCards(page)).toHaveCount(CHARTABLE_METRIC_COUNT);

  const restore = await throttleCpu(page, 4);
  const result = await scrollAndMeasure(page, FLICK);
  await restore();

  expect(result.chartMounts).toBeLessThan(12);
  expect(result.chartUnmounts).toBeLessThan(12);
  expect(result.maxFrameMs).toBeLessThan(2000);
  // The sweep did not knock the socket over on its way past either.
  expect(backend.socketOpens).toBe(1);
});

test("a card scrolled past without stopping never mounts at all", async ({ page }) => {
  // The cancel path in isolation. Mounts DURING the sweep, not the count at
  // rest: the count at rest was always small, because the old code unmounted
  // each card as it left. What was broken was everything it built on the way.
  const backend = await openHistory(page);
  await selectRange(page, "Last week");
  await expect(metricCards(page)).toHaveCount(CHARTABLE_METRIC_COUNT);

  backend.resetRequests();
  const restore = await throttleCpu(page, 4);
  const mounts = await countChartMounts(page, () =>
    scrollPage(page, { seconds: 6, stepFraction: 0.5, intervalMs: 30 }),
  );
  await restore();

  // Measured 26-30 before the queue. Nothing the flick passes over may build.
  expect(mounts).toBeLessThan(5);

  // …and this is not "lazily mount nothing, ever": the cards the flick came to
  // rest on do build, once it settles.
  await page.waitForTimeout(1500);
  const settled = await mountedCharts(page).count();
  expect(settled).toBeGreaterThan(0);
  // The ±1500px retention band holds 12-15 charts by design — ~25MB at the
  // measured 1.7MB per LayerChart instance. What it must never approach is the
  // 63 of the whole grid, which would be ~100MB on the tablet this is for.
  expect(settled).toBeLessThan(20);
  expect(backend.requestCount("/api/history/rollup")).toBeLessThan(25);
});
