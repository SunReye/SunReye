import { expect, test } from "@playwright/test";
import { CHARTABLE_METRIC_COUNT } from "./support/api-mock";
import { metricCards, openHistory, selectRange } from "./support/history";
import { scrollAndMeasure, throttleCpu } from "./support/perf";

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
 * The assertion is a per-mount average of blocked time, not a wall clock: the
 * sweep mounts a different number of cards depending on how the lazy-mount
 * window behaves, and dividing keeps this readable as "what one card costs"
 * whatever that other work settles on.
 *
 * Read as a ratio, never as an absolute: this browser composites in software,
 * so the SAME page it measured at 278ms on the tablet costs ~470ms per mount
 * here. With the gate and the downsampling it costs ~195ms here — and pushing
 * the row cap a further 8x down only reached ~165ms, which is what says path
 * construction has stopped being the dominant term and the rest belongs to
 * work these two fixes were never about.
 *
 * The budget is set between the two: comfortably above what the fixed page
 * measures (so a slow CI runner does not fail it) and comfortably below what
 * either fix costs on its own if it is dropped — losing the gate alone doubles
 * this number back over the line.
 */
const BUDGET_MS_PER_MOUNT = 280;

test("a preset-range card builds inside its per-mount budget", async ({ page }) => {
  const backend = await openHistory(page);
  await selectRange(page, "Last week");
  await expect(metricCards(page)).toHaveCount(CHARTABLE_METRIC_COUNT);

  const restore = await throttleCpu(page, 4);
  // A DWELLING gesture on purpose. This spec measures what a mount COSTS, so it
  // needs mounts to happen — and after the deferral fix a continuous flick
  // correctly builds nothing at all (that is the other spec's job). Dwelling
  // past the queue's 400 ms settle window is the reader stopping to look, which
  // is exactly when the cost being budgeted here is paid.
  const result = await scrollAndMeasure(page, {
    seconds: 12,
    stepFraction: 0.5,
    dwellMs: 700,
  });
  await restore();

  // A sweep that mounted nothing would pass the budget by doing no work.
  expect(result.chartMounts).toBeGreaterThan(3);

  const perMount = result.blockedMs / result.chartMounts;
  console.log(
    `per-mount ${perMount.toFixed(0)}ms · mounts ${result.chartMounts} · blocked ${result.blockedMs.toFixed(0)}ms · fps ${result.fps.toFixed(1)}`,
  );
  expect(perMount).toBeLessThan(BUDGET_MS_PER_MOUNT);

  // The fixes must not buy their time by refetching or by dropping the feed.
  expect(backend.unhandled).toEqual([]);
  expect(backend.socketOpens).toBe(1);
});
