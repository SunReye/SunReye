/**
 * What /statistics asks the server for, once it is up and while it stays up.
 *
 * Every section reads through one query module (`lib/statistics/statistics-query`),
 * which keys each read by its spec and makes it stale on a live push. Both
 * halves only exist in a running page: a read that tracks the value it writes
 * refetches forever (the request storm), and a read that tracks nothing never
 * refreshes. The unit suite proves what the module WOULD do with a counter
 * bump; only this proves the page's effects actually hand it one.
 *
 * Counts, never timings (TESTING.md): each read is asked for once per push.
 */

import { expect, test, type Page } from "@playwright/test";
import { openPage } from "./support/open-page";
import type { MockBackend } from "./support/api-mock";

/** Every read the default page (this month, detail scope) makes, by endpoint. */
const READS = {
  comparison: /\/api\/statistics\/comparison\?/,
  costBars: /\/api\/cost\/series\?(?!.*bucket=month)/,
  energyPeriods: /\/api\/energy\/series\?(?!.*bucket=month)/,
  amortisation: /\/api\/statistics\/amortisation\?/,
  records: /\/api\/statistics\/records\?/,
  heatmap: /\/api\/statistics\/heatmap\?/,
  yoy: /\/api\/(cost|energy)\/series\?.*bucket=month/,
  spotStats: /\/api\/statistics\/prices\?/,
  dayAhead: /\/api\/prices$/,
} as const;
type Read = keyof typeof READS;

function counts(backend: MockBackend): Record<Read, number> {
  return Object.fromEntries(
    Object.entries(READS).map(([name, pattern]) => [name, backend.requestCount(pattern)]),
  ) as Record<Read, number>;
}

/** The page with every section's first answer on screen. */
async function openStatistics(page: Page) {
  // Installed before the first navigation so the live feed's one-minute
  // throttle can be stepped past without waiting for it.
  await page.clock.install();
  const opened = await openPage(page, "/#/statistics");
  await expect(page.getByRole("heading", { level: 2, name: "Spot prices" })).toBeVisible();
  await expect(page.getByText("All-time daily records")).toBeVisible();
  await expect.poll(() => Object.values(counts(opened.backend)).every((n) => n > 0)).toBe(true);
  return opened;
}

test("a settled page asks for nothing more", async ({ page }) => {
  const { backend } = await openStatistics(page);
  backend.resetRequests();
  await page.waitForTimeout(3000);
  expect(counts(backend)).toEqual({
    comparison: 0,
    costBars: 0,
    energyPeriods: 0,
    amortisation: 0,
    records: 0,
    heatmap: 0,
    yoy: 0,
    spotStats: 0,
    dayAhead: 0,
  });
});

test("a live push on a now-inclusive window refetches the energy reads once each", async ({
  page,
}) => {
  const { backend } = await openStatistics(page);
  // The feed ignores a push inside a minute of the lease: the page has just
  // fetched this window.
  await page.clock.fastForward("01:05");
  backend.resetRequests();
  await backend.pushStatistics();
  await expect.poll(() => backend.requestCount(READS.comparison)).toBe(1);
  // Settle, then take the census: a storm would keep climbing.
  await page.waitForTimeout(1500);
  expect(counts(backend)).toEqual({
    comparison: 1,
    costBars: 1,
    energyPeriods: 1,
    amortisation: 1,
    records: 0,
    heatmap: 0,
    yoy: 0,
    spotStats: 0,
    dayAhead: 0,
  });
});

test("a spot-price sync refetches the price reads once each, and nothing else", async ({
  page,
}) => {
  const { backend } = await openStatistics(page);
  backend.resetRequests();
  await backend.pushStatistics({ type: "prices" });
  await expect.poll(() => backend.requestCount(READS.dayAhead)).toBe(1);
  await page.waitForTimeout(1500);
  expect(counts(backend)).toEqual({
    comparison: 0,
    costBars: 0,
    energyPeriods: 0,
    amortisation: 0,
    records: 0,
    heatmap: 0,
    yoy: 0,
    // One request for two readers: the section list's gate and the section body.
    spotStats: 1,
    dayAhead: 1,
  });
});
