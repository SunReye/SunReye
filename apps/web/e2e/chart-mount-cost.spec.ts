import { expect, test } from "@playwright/test";
import { CHARTABLE_METRIC_COUNT } from "./support/api-mock";
import { metricCards, openHistory, selectRange } from "./support/history";
import { calibrateCpu, measureMountCost, perMountCost, throttleCpu } from "./support/perf";

/**
 * What a single /history card costs to build on a preset range.
 *
 * Measured on the tablet profile before this work: 278ms per mount, of which
 * ~270ms was path construction — 1876 rollup rows x three series drawn into a
 * ~450px box, and every one of them drawn TWICE because the plot rendered once
 * at `plotWidth = 0` and again once `bind:clientWidth` landed and the gutters
 * changed. The two fixes are the measuring gate (`shouldRenderPlot`) and LTTB
 * downsampling to the plot's own pixel budget.
 *
 * ## Why this is a work RATIO and not a millisecond budget
 *
 * It was `blockedMs / chartMounts` under a fixed 12 s scroll sweep, against a
 * 280 ms budget. That metric measured the machine at least as much as the code,
 * and it failed on CI at 296.8 ms on the commit BEFORE the chart work and
 * 308.5 ms on the commit after, while reading 165 ms on the development box.
 * Neither number was a regression. Two separate faults:
 *
 * 1. The numerator was mostly not mount cost. Scrolling a stack of sixty cards
 *    re-layouts and repaints every chart already on screen, and under a 4x
 *    throttle each of those frames is a long task. Fitting the runs gave
 *    `blocked ~= 3600ms + ~100ms x mounts` — the constant is the scroll, and a
 *    fixed-duration sweep pays it whatever happens.
 * 2. So dividing by the mount count read `3600/mounts + 100`: a hyperbola in
 *    the DENOMINATOR, and the denominator is exactly what a slower machine
 *    changes, because fewer dwell cycles finish inside a fixed 12 s. On one
 *    unchanged tree, varying only the throttle:
 *
 *    | throttle | mounts | blocked | blocked/mounts |
 *    | -------- | ------ | ------- | -------------- |
 *    | 4x       | 42     | 7489    | 178            |
 *    | 6x       | 32     | 9144    | 286            |
 *    | 8x       | 20     | 8494    | 425            |
 *
 *    `corr(blocked/mounts, mounts) = -0.91`. CI is roughly half this box's
 *    speed, so it mounted about twenty charts and spread the whole scroll
 *    constant across them — which is the entire 296-308 ms reading.
 *
 * `measureMountCost` fixes the numerator by running the probe ONLY while the
 * page is held still, so scroll cost is never attributed to a mount, and fixes
 * the denominator by waiting for the build burst to go quiet instead of for a
 * fixed dwell — a slower runner is given the time it needs rather than having
 * the window shut mid-build. `perMountCost` then divides by `calibrateCpu`, so
 * the budget is denominated in this machine's own CPU work.
 *
 * What that buys, all on healthy code, same tree:
 *
 * | throttle | mounts | raw ms/mount | work/mount |
 * | -------- | ------ | ------------ | ---------- |
 * | 4x       | 56     | 156          | 0.32       |
 * | 8x       | 44     | 440          | 0.45       |
 * | 12x      | 38     | 852          | 0.58       |
 * | 16x      | 36     | 1063         | 0.55       |
 *
 * The mount count now holds (56 down to 36 across a 4x CPU span, where the old
 * sweep fell 42 to 20 across 2x), and the ratio SATURATES around 0.55-0.58. It
 * drifts up to there because `longtask` cannot see work under 50 ms, so a fast
 * machine under-reports; once every mount task crosses the threshold nothing is
 * missing and the figure stops moving. Healthy code therefore cannot read much
 * above ~0.58 however slow the runner is, which is what makes a fixed budget
 * defensible here where a millisecond one was not.
 *
 * ## The budget
 *
 * 0.70 sits in the gap between that ceiling and what the fixes cost if dropped.
 * Reverting the measuring gate, keeping this spec:
 *
 * | throttle | healthy | gate dropped |
 * | -------- | ------- | ------------ |
 * | 4x       | 0.32    | 0.83         |
 * | 8x       | 0.46    | 1.08         |
 *
 * So it clears the worst healthy reading measured on any throttle (0.58, on a
 * box a third this one's speed) by 21%, clears the CI-speed reading by 56%, and
 * still catches a dropped gate at either end. Deliberately NOT set just above
 * the observed value: a budget tuned to hug the current number is a failure
 * scheduled for the next runner. The window is genuinely narrow — 0.58 healthy
 * against 0.83 broken on a fast box — so if this needs to move, move the
 * instrument rather than the number, and re-measure both columns.
 *
 * For the record, since the chart-interaction work was suspected of a 11%
 * regression here: on this instrument the commit before it reads 0.318 and the
 * commit itself 0.327, three runs each. That ~3% is the shared `PowerArea` and
 * the tooltip root, it is real, and it is not what the old spec was reporting.
 * The /history cards drew their gradient before that work and after it — 15
 * charts, 15 `linearGradient` nodes, 60 `defs` on both commits — and the
 * tooltip placement never runs at mount, because LayerChart gates the whole
 * tooltip on `ctx.tooltip.data` and so the `$derived` behind it is never read
 * until a pointer arrives: 35 `getBoundingClientRect` calls for 44 mounts.
 *
 * LTTB is the weaker of the two signals — dropping it reads 0.38 against 0.32,
 * because at a ~900 point budget against 1876 rows path construction has
 * stopped being the dominant term. That was equally true of the millisecond
 * version of this spec (its own note records 165 ms against 195 ms for an 8x
 * row-cap change, both comfortably inside 280), so no sensitivity is lost here.
 * `downsample` carries its own unit tests for the reduction itself.
 */
const BUDGET_WORK_PER_MOUNT = 0.7;

/**
 * Charts the sweep must actually build for the average to mean anything. The
 * measured runs mount 36-56; this only has to rule out a page that mounted
 * nothing and passed by doing no work.
 */
const MIN_MOUNTS = 20;

test("a preset-range card builds inside its per-mount budget", async ({ page }) => {
  const backend = await openHistory(page);
  await selectRange(page, "Last week");
  await expect(metricCards(page)).toHaveCount(CHARTABLE_METRIC_COUNT);

  const restore = await throttleCpu(page, 4);
  // Each step scrolls, then HOLDS STILL and measures until the charts that step
  // queued have finished building. Holding still is what separates mount cost
  // from scroll cost; waiting for quiet rather than a fixed dwell is what keeps
  // the count comparable on a slower machine.
  const measured = await measureMountCost(page, {
    steps: 12,
    stepFraction: 0.5,
  });
  const cpuUnitMs = await calibrateCpu(page);
  await restore();

  // A sweep that mounted nothing would pass the budget by doing no work.
  expect(measured.chartMounts).toBeGreaterThan(MIN_MOUNTS);

  const work = perMountCost(measured, cpuUnitMs);
  console.log(
    `work/mount ${work.toFixed(3)} · mounts ${measured.chartMounts} · blocked ${measured.blockedMs.toFixed(0)}ms · raw ${(measured.blockedMs / measured.chartMounts).toFixed(0)}ms/mount · cpu unit ${cpuUnitMs.toFixed(0)}ms`,
  );
  expect(work).toBeLessThan(BUDGET_WORK_PER_MOUNT);

  // The fixes must not buy their time by refetching or by dropping the feed.
  expect(backend.unhandled).toEqual([]);
  expect(backend.socketOpens).toBe(1);
});
