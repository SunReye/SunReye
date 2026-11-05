/**
 * The scroll sweep on /history, measured end to end under a 4x CPU throttle. Printed, not asserted:
 * how many charts a flick builds depends on the host holding the gesture's pace, and the long-task
 * and frame numbers on how fast it is. `bun run bench:e2e` prints them; nothing fails.
 *
 * Baseline on the tablet profile (dpr 2, 4x CPU throttle) before the mount queue:
 *   /history, Last week, 12 s sweep: 10.6 fps, 34 long tasks, 9452 ms blocked, 59 chart mounts and
 *   59 unmounts: one full LayerChart construction for each of the 63 cards the sweep passed.
 *
 * The mount queue admits a card only once the scroll has gone quiet and cancels one that leaves
 * first, so a flick that passes a card never builds it. A FLICK (`dwellMs` 0) never goes quiet:
 * expect a handful of mounts. `scrollPage` runs the gesture inside the page, since a gesture driven
 * from the test process turns into a few jumps under throttle.
 *
 * This browser composites in software: read the numbers as ratios between runs on one machine.
 */

import { test } from "@playwright/test";
import { CHARTABLE_METRIC_COUNT } from "../e2e/support/api-mock";
import { metricCards, mountedCharts, openHistory, selectRange } from "../e2e/support/history";
import { countChartMounts, scrollAndMeasure, scrollPage, throttleCpu } from "../e2e/support/perf";
import { report } from "./report";

/** A continuous gesture: a step every 40ms, so the scroll never goes quiet. */
const FLICK = { seconds: 12, stepFraction: 0.5, intervalMs: 40 } as const;

test("preset-range sweep", async ({ page }) => {
  const backend = await openHistory(page);
  await selectRange(page, "Last week");
  await metricCards(page).first().waitFor();

  backend.resetRequests();
  const restore = await throttleCpu(page, 4);
  const result = await scrollAndMeasure(page, FLICK);
  await restore();

  report("history-scroll-mounts preset range", {
    cards: CHARTABLE_METRIC_COUNT,
    mounts: result.chartMounts,
    unmounts: result.chartUnmounts,
    fps: result.fps,
    longTasks: result.longTasks,
    blockedMs: result.blockedMs,
    rollupRequests: backend.requestCount("/api/history/rollup"),
  });
});

test("live-range sweep", async ({ page }) => {
  const backend = await openHistory(page);
  await metricCards(page).first().waitFor();

  const restore = await throttleCpu(page, 4);
  const result = await scrollAndMeasure(page, FLICK);
  await restore();

  report("history-scroll-mounts live range", {
    mounts: result.chartMounts,
    unmounts: result.chartUnmounts,
    fps: result.fps,
    blockedMs: result.blockedMs,
    maxFrameMs: result.maxFrameMs,
    socketOpens: backend.socketOpens,
  });
});

test("flick past a card, then rest", async ({ page }) => {
  const backend = await openHistory(page);
  await selectRange(page, "Last week");
  await metricCards(page).first().waitFor();

  backend.resetRequests();
  const restore = await throttleCpu(page, 4);
  const mounts = await countChartMounts(page, () =>
    scrollPage(page, { seconds: 6, stepFraction: 0.5, intervalMs: 30 }),
  );
  await restore();

  // The ±1500px retention band holds 12-15 charts by design (~25 MB at 1.7 MB per instance).
  await page.waitForTimeout(1500);
  report("history-scroll-mounts flick then rest", {
    mountsDuringFlick: mounts,
    chartsAtRest: await mountedCharts(page).count(),
    rollupRequests: backend.requestCount("/api/history/rollup"),
  });
});
