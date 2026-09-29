/**
 * A live window on /history, one minute later.
 *
 * `history-period-step` and `history-custom-chart-today` prove the Day tab
 * standing on today is fetched ONCE — but against a fixture that answers the
 * whole window, future included, so the minute-tick delta never has anything to
 * ask for and never runs. That path is where the refetch loops lived (PR #60,
 * #216): a tick re-deriving the window refetches every card in full, and a delta
 * that invalidates on its own answer asks forever.
 *
 * `rollupUntilNow` makes the fixture stop at the present like the real
 * aggregate, and the feed is driven by hand so the clock ticks exactly once.
 * Both charts on the page go through `liveRollup` — the metric cards and the
 * saved overlay — so both are counted.
 */

import { expect, test } from "@playwright/test";
import { mountedCharts, openHistory, periodNavigator, rollupCalls } from "./support/history";

/** Long enough for a burst of per-card fetches to finish and the page to go quiet. */
const SETTLE_MS = 2000;
const OVERLAY = ["dc.pv1.power", "dc.pv2.power"];

/** Requests per metric key. */
function perMetric(calls: { metric: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of calls) out[c.metric] = (out[c.metric] ?? 0) + 1;
  return out;
}

test("a minute tick asks each live chart for its delta once, and never the whole day", async ({
  page,
}) => {
  // A fake clock so one minute can pass on demand; frames by hand, because a
  // frame is what ticks `liveClock`.
  await page.clock.install();
  const backend = await openHistory(page, {
    rollupUntilNow: true,
    feedIntervalMs: 0,
    customCharts: [{ id: "chart-1", name: "PV strings", metrics: OVERLAY }],
  });
  await expect(periodNavigator(page).forward).toBeDisabled();
  await expect(mountedCharts(page).first()).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);

  const loaded = rollupCalls(backend);
  const windowStart = loaded[0]!.from;
  // The full-window fetch, once per chart that wants it.
  expect(new Set(loaded.map((c) => c.from))).toEqual(new Set([windowStart]));
  for (const metric of OVERLAY) expect(perMetric(loaded)[metric]).toBeGreaterThan(0);

  // ── One tick ─────────────────────────────────────────────────────────────
  backend.resetRequests();
  await page.clock.fastForward("02:00");
  await backend.pushMetrics();
  await expect.poll(() => rollupCalls(backend).length).toBeGreaterThan(0);
  await page.waitForTimeout(SETTLE_MS);

  const deltas = rollupCalls(backend);
  // Deltas, not reloads: a tick that re-derives the window refetches from
  // midnight on every card.
  for (const call of deltas) expect(call.from).not.toBe(windowStart);
  // Exactly one per chart that loaded — a delta that re-asks on its own answer
  // would keep climbing with no further tick.
  expect(perMetric(deltas)).toEqual(perMetric(loaded));
});

/** Two minutes before midnight, in the browser's own zone — the page's zone. */
const BEFORE_MIDNIGHT = new Date(2026, 7, 20, 23, 58);

test("past midnight, yesterday's window is not re-asked once a minute", async ({ page }) => {
  // The day's last bucket stays the newest a chart holds, so every minute past
  // midnight looked due: each live chart re-asked for 23:59 once a minute until
  // the reader navigated — ~60 requests a minute on /history.
  await page.clock.install({ time: BEFORE_MIDNIGHT });
  const backend = await openHistory(page, {
    feedIntervalMs: 0,
    customCharts: [{ id: "chart-1", name: "PV strings", metrics: OVERLAY }],
  });
  await expect(mountedCharts(page).first()).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);
  const dayEnd = rollupCalls(backend)[0]!.to;

  // Across midnight, then one tick to let anything still owed land.
  await page.clock.fastForward("03:00");
  await backend.pushMetrics();
  await page.waitForTimeout(SETTLE_MS);

  backend.resetRequests();
  for (let minute = 0; minute < 3; minute++) {
    await page.clock.fastForward("01:00");
    await backend.pushMetrics();
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(SETTLE_MS);

  expect(rollupCalls(backend).filter((c) => c.to === dayEnd)).toEqual([]);
});
