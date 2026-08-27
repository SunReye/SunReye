/**
 * The live-readout storm.
 *
 * The live readout renders in the card's readout row, the first row of the body,
 * which sits ABOVE the `{#if !mounted}` gate — as the Section's `actions` snippet
 * it came from did too, so nothing about this hazard changed when it moved. All
 * 63 history cards ran a readout Tween while only four charts existed. At the measured 1s feed cadence the glide is
 * 1150ms, LONGER than the interval, so each of those rAF loops never settles.
 * Measured on the tablet: 829 characterData mutations per 10s on /history
 * against 78 on the overview.
 *
 * The fix hands each readout its card's own visibility and turns that into a
 * 0ms glide, which makes the Tween snap and start no loop at all. So the
 * off-screen readout still updates — it just steps instead of drifting.
 */

import { expect, test } from "@playwright/test";
import { CHARTABLE_METRIC_COUNT } from "./support/api-mock";
import { metricCards, mountedCharts, openHistory } from "./support/history";
import { countTextMutations } from "./support/perf";

/** Feed `frames` samples by hand, so the count is per sample, not per wall clock. */
const pushFrames = (backend: { pushMetrics: () => Promise<unknown> }, frames: number) =>
  async function () {
    for (let i = 0; i < frames; i++) {
      await backend.pushMetrics();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };

test("off-screen readouts step instead of gliding, so the page stops repainting text", async ({
  page,
}) => {
  const backend = await openHistory(page, { feedIntervalMs: 0 });
  await expect(metricCards(page)).toHaveCount(CHARTABLE_METRIC_COUNT);

  // Only a handful of cards are on screen; the rest must be silent between
  // samples rather than tweening for 1150ms each.
  const onScreen = await mountedCharts(page).count();
  expect(onScreen).toBeLessThan(15);

  const mutations = await countTextMutations(page, pushFrames(backend, 5));

  // Five samples across ~1s. Measured here: 2399 writes before the gate, 512
  // after. The remainder is the handful of cards actually on screen, which are
  // SUPPOSED to glide — the point of the fix is that the storm now scales with
  // what you can see (about ten cards) instead of with the whole 63-card page.
  expect(mutations).toBeLessThan(1000);
});

test("a readout still shows the latest value while it is off screen", async ({ page }) => {
  // The gate is a DURATION, not an unmount. If it were an unmount, an
  // off-screen card would hold a stale figure — or an em dash — and flash on
  // re-entry. Assert the value, not just the quiet.
  const backend = await openHistory(page, { feedIntervalMs: 0 });
  await expect(metricCards(page)).toHaveCount(CHARTABLE_METRIC_COUNT);

  // The LAST readout on a 63-card page is far below the fold, so it is
  // unambiguously one of the gated ones.
  const readout = page.locator("span.font-mono.tabular-nums").last();

  await backend.pushMetrics();
  const first = (await readout.textContent())?.trim();
  expect(first).toBeTruthy();
  expect(first).not.toBe("—");

  // It keeps tracking the feed — snapped, but current.
  for (let i = 0; i < 4; i++) await backend.pushMetrics();
  await expect(readout).not.toHaveText("—", { timeout: 3000 });
  await expect(readout).not.toHaveText(first as string, { timeout: 3000 });
});
