/**
 * What /history has fetched once a scroll sweep is over, counted rather than timed.
 *
 * The mount queue admits a card only after the scroll goes quiet, and the rollup fetch is per built
 * chart. A queue that admits every card it passes asks for all of them: a count at rest, so it
 * means the same on a contended runner as on an idle one. How many charts a flick builds on the
 * way, and what that costs, depends on the host holding the gesture's pace:
 * `bench/history-scroll-mounts.bench.ts`.
 */

import { expect, test } from "@playwright/test";
import { CHARTABLE_METRIC_COUNT } from "./support/api-mock";
import { metricCards, mountedCharts, openHistory, selectRange } from "./support/history";
import { scrollPage } from "./support/perf";

test("a sweep fetches for the cards it rests on, not for every card it passes", async ({
  page,
}) => {
  const backend = await openHistory(page);
  await selectRange(page, "Last week");
  await expect(metricCards(page)).toHaveCount(CHARTABLE_METRIC_COUNT);
  await backend.settled();
  backend.resetRequests();

  await scrollPage(page, { seconds: 6, stepFraction: 0.5, intervalMs: 30 });

  // The cards the flick came to rest on do build: a queue that never admits would pass the
  // ceiling below.
  await expect.poll(() => mountedCharts(page).count()).toBeGreaterThan(0);
  await backend.settled();
  // 63 cards in the grid; the retention band holds 12-15 charts.
  expect(backend.requestCount("/api/history/rollup")).toBeLessThan(25);
  expect(backend.unhandled).toEqual([]);
});
