/**
 * The custom-chart section on /history, standing on today (#216).
 *
 * #216 was fixed on the metric cards first: `historyPeriodRange` stopped
 * resolving today to a five-minute window, and `entity-history-card` started
 * fetching every range. `overlay-chart-view` — the renderer behind a SAVED
 * custom chart and behind a full-screen draft — still read `range.live` the old
 * way, so the section at the TOP of the page kept drawing two minutes of the RAM
 * buffer above a grid of full-day cards, and issued no rollup call at all.
 *
 * Neither half is a value a unit test can reach: the merge and the delta
 * arithmetic are unit-tested in `overlay-chart.test.ts`, but "did it ask the
 * server, once, for the civil day" only exists once there is a document.
 *
 * An overlay mounts only for a chart the server has saved, which is why nothing
 * covered it: the mock's `/api/custom-charts` answers `[]` by default. This spec
 * is the reason `BackendOptions.customCharts` exists.
 */

import { expect, test } from "@playwright/test";
import { mountedCharts, openHistory, periodNavigator, rollupCalls } from "./support/history";

/** Long enough for the per-card fetch burst to finish and the page to go quiet. */
const SETTLE_MS = 2000;

const OVERLAY = ["dc.pv1.power", "dc.pv2.power"];

test("a saved custom chart fetches today's civil day, once per series", async ({ page }) => {
  const backend = await openHistory(page, {
    customCharts: [{ id: "chart-1", name: "PV strings", metrics: OVERLAY }],
  });

  // The page opens on the current day, which is the case that was broken.
  await expect(periodNavigator(page).forward).toBeDisabled();
  await expect(mountedCharts(page).first()).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);

  const calls = rollupCalls(backend);

  // ── It asked at all ────────────────────────────────────────────────────────
  // The old code returned from its fetch effect on `range.live`, so this list
  // held nothing for either overlay series while the chart drew the buffer.
  const perSeries = OVERLAY.map((metric) => calls.filter((c) => c.metric === metric));
  for (const series of perSeries) expect(series.length).toBeGreaterThan(0);

  // ── Once ───────────────────────────────────────────────────────────────────
  // Two asks for one series is the delta refresh firing on its own answer —
  // the same request storm the metric cards already shipped once (PR #60), and
  // an overlay asks once PER KEY, so the storm here is N times worse.
  //
  // The card below draws `dc.pv1.power` too, so a series is counted by its
  // distinct WINDOWS: one window, however many components want it.
  for (const series of perSeries) {
    expect(new Set(series.map((c) => `${c.from}|${c.to}`)).size).toBe(1);
  }

  // ── And the window is the civil day, at minute grain ───────────────────────
  const overlayCall = perSeries[0][0];
  expect(overlayCall.bucket).toBe("minute");
  const civilDay = await page.evaluate(
    ([from, to]) => {
      const start = new Date(from);
      const midnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      return {
        startsAtMidnight: start.getTime() === midnight.getTime(),
        endsAtNextMidnight: new Date(to).getTime() === next.getTime(),
      };
    },
    [overlayCall.from, overlayCall.to],
  );
  expect(civilDay).toEqual({ startsAtMidnight: true, endsAtNextMidnight: true });

  // Stated as the window's WIDTH rather than "a point older than five minutes",
  // which a run started at 00:03 could not claim about a correct page.
  const spanMs = Date.parse(overlayCall.to) - Date.parse(overlayCall.from);
  expect(spanMs).toBeGreaterThanOrEqual(23 * 3600_000);
});
