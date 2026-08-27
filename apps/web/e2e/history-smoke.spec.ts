import { expect, test } from "@playwright/test";
import { CHARTABLE_METRIC_COUNT } from "./support/api-mock";
import { metricCards, mountedCharts, openHistory } from "./support/history";
import { countRequests, countTextMutations } from "./support/perf";

/**
 * Proof the harness itself works: the mocks match the real contracts and the
 * probes see the real work.
 *
 * The two CPU-throttled 12-second sweeps that used to end this file are gone
 * with the rest of the measurement layer — they asserted `fps > 0`, which is
 * liveness rather than a budget, and cost ~24 s of the suite's wall clock. What
 * is left asserts behaviour a contended machine cannot change: how many requests
 * a settled page makes, that the socket opens once, that the card count matches
 * the manifest.
 */

test.describe("/history harness", () => {
  test("boots the workspace with every API call stubbed", async ({ page }) => {
    const backend = await openHistory(page);

    // A missing stub is the failure mode that matters most: the shell stays
    // behind its first-run gate and the page never renders at all.
    expect(backend.unhandled).toEqual([]);
    // Regex, not the substring form: "/api/profile" also matches
    // "/api/profile-status", which the gate fetches on the way here.
    expect(backend.requestCount(/\/api\/profile$/)).toBe(1);

    // One card per chartable metric of the fixture profile (a real 105-metric
    // Deye manifest → 63 cards).
    await expect(metricCards(page)).toHaveCount(CHARTABLE_METRIC_COUNT);

    // Lazy mount: only the cards near the viewport have a chart.
    const mounted = await mountedCharts(page).count();
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(CHARTABLE_METRIC_COUNT);
  });

  test("serves a driveable live feed the page consumes", async ({ page }) => {
    const backend = await openHistory(page, { feedIntervalMs: 0 });

    // The client asked for exactly the topic the shell leases.
    expect(backend.clientFrames).toContainEqual({ t: "sub", topics: ["metrics"] });

    // Live readouts repaint through text nodes — the readout-storm probe.
    const mutations = await countTextMutations(page, async () => {
      for (let i = 0; i < 5; i++) {
        await backend.pushMetrics();
        await page.waitForTimeout(200);
      }
    });
    expect(mutations).toBeGreaterThan(0);
  });

  test("no request storm on a settled page (the PR60 regression probe)", async ({ page }) => {
    const backend = await openHistory(page);

    // The shell's `$effect` re-leasing the socket showed up as `/api/profile`
    // and `/api/history/recent` refetching ~12 times a second, and the socket
    // being closed before it could open. On a settled page: neither.
    const boots = await countRequests(page, /\/api\/(profile|history\/recent)\b/, () =>
      page.waitForTimeout(3000),
    );
    expect(boots).toBe(0);
    expect(backend.socketOpens).toBe(1);
  });
});
