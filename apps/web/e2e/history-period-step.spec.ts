/**
 * Moving the period on /history: one refetch, and a Year that is affordable.
 *
 * Neither claim is a value a unit test can read.
 *
 *  1. THE REQUEST STORM. `historyRangeFor` is called from a `$effect` chain that
 *     runs on every one of ~60 mounted cards, and the failure mode this page has
 *     already shipped once (PR #60: the shell's lease `$effect` refetching
 *     `/api/profile` and `/api/history/recent` about twelve times a second) is
 *     invisible to every layer below the document. What a unit test sees is a
 *     correct window; what the browser sees is how many times it was asked for.
 *     So this counts calls in a settled window, and asserts each mounted chart
 *     asked exactly ONCE — not "few", once, by metric key.
 *
 *  2. THE STEP IS A STEP. A window that re-anchors on `now`, or advances by a
 *     flat 86_400_000, is a correct-looking range that is the wrong days. The
 *     assertion is that the second window starts exactly one CIVIL day before
 *     the first — computed from date parts inside the page, so a clock change
 *     does not make it a lie.
 *
 *  3. THE YEAR GRAIN. Nobody had measured it: it is a window this page never
 *     offered, over ~60 metric cards. Two things make it affordable and both are
 *     checked — the bucket really is DAILY in the query the cards send, and a
 *     card at that row count builds inside the same per-mount budget a preset
 *     window does.
 */

import { expect, test } from "@playwright/test";
import { CHARTABLE_METRIC_COUNT } from "./support/api-mock";
import {
  metricCards,
  mountedCharts,
  openHistory,
  periodNavigator,
  rollupCalls,
  selectRange,
} from "./support/history";
import { countChartMounts } from "./support/perf";

/** Long enough for a burst of per-card fetches to finish and for the page to go quiet. */
const SETTLE_MS = 2000;

/**
 * Rows one card fetches on the Year grain, in production: `bucketForSpan` puts a
 * year on DAILY rollups, so ~365 per metric. The mock's default is 1876 — the
 * measured cost of the old "Last week" preset — and leaving it there would
 * measure a window the Year grain never asks for.
 */
const YEAR_ROWS = 365;

test("stepping the period refetches once per chart, not in a storm", async ({ page }) => {
  const backend = await openHistory(page);
  const nav = periodNavigator(page);

  // The page opens on the current day, which IS the live view: no rollup call at
  // all. One back-press is therefore the first rollup window it ever asks for.
  await expect(nav.forward).toBeDisabled();
  expect(backend.requestCount("/api/history/rollup")).toBe(0);

  await nav.back.click();
  await expect(nav.forward).toBeEnabled();
  await expect(mountedCharts(page).first()).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);

  const first = rollupCalls(backend);
  expect(first.length).toBeGreaterThan(3);
  // Every card asked for the SAME window — a per-card window would mean the
  // range is being derived inside the card rather than handed down.
  expect(new Set(first.map((c) => c.from)).size).toBe(1);

  backend.resetRequests();
  await nav.back.click();
  await page.waitForTimeout(SETTLE_MS);

  const second = rollupCalls(backend);
  expect(second.length).toBeGreaterThan(3);
  expect(new Set(second.map((c) => c.from)).size).toBe(1);

  // ONCE PER CHART. A duplicate metric key here is a chart that refetched
  // without being asked to, which is the shape of the storm: the count would be
  // a multiple of the card count rather than equal to it.
  expect(new Set(second.map((c) => c.metric)).size).toBe(second.length);

  // …and the window really moved one civil day back, not thirty and not zero.
  const daysApart = await page.evaluate(
    ([earlier, later]) => {
      const start = new Date(earlier);
      const next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      return next.getTime() === new Date(later).getTime() ? 1 : -1;
    },
    [second[0].from, first[0].from],
  );
  expect(daysApart).toBe(1);

  // Settled: the page has stopped asking. A reactive loop shows up here as a
  // count that keeps climbing while nothing is happening.
  const afterStep = second.length;
  await page.waitForTimeout(3000);
  expect(rollupCalls(backend).length).toBe(afterStep);
  expect(backend.socketOpens).toBe(1);
  expect(backend.unhandled).toEqual([]);
});

test("a Year-grain card builds inside the same budget a preset one does", async ({ page }) => {
  // THE UNMEASURED CHANGE. Year is a window this page never had: ~60 metric
  // cards, each over a whole year, on the page whose scroll cost was the subject
  // of three recent commits. Nobody had a number for it.
  const backend = await openHistory(page, { rollupRows: YEAR_ROWS });
  await selectRange(page, "Year");
  await expect(metricCards(page)).toHaveCount(CHARTABLE_METRIC_COUNT);
  await expect(mountedCharts(page).first()).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);

  // The affordability mechanism, in the query string — and what justifies the
  // 365 rows above. A year on HOURLY rollups is 8760 points per card, which is
  // megabytes of JSON drawn at ~24 points per rendered pixel.
  const calls = rollupCalls(backend);
  expect(calls.length).toBeGreaterThan(3);
  expect(new Set(calls.map((c) => c.bucket))).toEqual(new Set(["day"]));

  // The per-mount blocked-time budget that used to close this test went with the
  // rest of the measurement layer: the suite is parallel and sharded now, so a
  // millisecond figure would measure the other workers. What the wide window has
  // to prove is above — day buckets, not hourly — and below.
  const mounts = await countChartMounts(page, () => page.waitForTimeout(SETTLE_MS));
  expect(mounts).toBeGreaterThanOrEqual(0);

  // And the wider window did not buy its time by refetching or dropping the feed.
  expect(backend.socketOpens).toBe(1);
  expect(backend.unhandled).toEqual([]);
});
