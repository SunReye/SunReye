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

/**
 * Every read the page makes against the core as shipped, by endpoint. It serves the energy series
 * alone, so that is all there is to count: the headline tiles and the Energy section's charts each
 * read it (two datasets, one URL), and nothing priced, no heatmap and no battery health is asked for.
 */
const READS = {
  energyPeriods: /\/api\/energy\/series\?/,
  priced: /\/api\/(statistics\/|cost\/|prices|battery\/health)/,
} as const;
type Read = keyof typeof READS;

function counts(backend: MockBackend): Record<Read, number> {
  return Object.fromEntries(
    Object.entries(READS).map(([name, pattern]) => [name, backend.requestCount(pattern)]),
  ) as Record<Read, number>;
}

/** The page with the Energy section's first answer on screen. */
async function openStatistics(page: Page) {
  // Installed before the first navigation so the live feed's one-minute
  // throttle can be stepped past without waiting for it.
  await page.clock.install();
  const opened = await openPage(page, "/#/statistics");
  await expect(page.getByRole("heading", { level: 2, name: "Energy", exact: true })).toBeVisible();
  await expect.poll(() => counts(opened.backend).energyPeriods).toBeGreaterThan(0);
  return opened;
}

test("a settled page asks for nothing more", async ({ page }) => {
  const { backend } = await openStatistics(page);
  backend.resetRequests();
  await backend.settled();
  expect(counts(backend)).toEqual({ energyPeriods: 0, priced: 0 });
});

test("a live push on a now-inclusive window refreshes the energy reads once each", async ({
  page,
}) => {
  const { backend } = await openStatistics(page);
  // The feed ignores a push inside a minute of the lease: the page has just
  // fetched this window.
  await page.clock.fastForward("01:05");
  backend.resetRequests();
  await backend.pushStatistics();
  await expect.poll(() => backend.requestCount(READS.energyPeriods)).toBeGreaterThan(0);
  // Settle, then take the census: a storm would keep climbing.
  await backend.settled();
  // Two readers, one URL each: the headline tiles' window and the section's chart series.
  expect(counts(backend)).toEqual({ energyPeriods: 2, priced: 0 });
});

test("a spot-price sync refetches nothing: the core serves no prices", async ({ page }) => {
  const { backend } = await openStatistics(page);
  backend.resetRequests();
  await backend.pushStatistics({ type: "prices" });
  await backend.settled();
  expect(counts(backend)).toEqual({ energyPeriods: 0, priced: 0 });
});
