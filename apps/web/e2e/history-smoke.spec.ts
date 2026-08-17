import { expect, test } from "@playwright/test";
import { CHARTABLE_METRIC_COUNT } from "./support/api-mock";
import { metricCards, mountedCharts, openHistory, selectRange } from "./support/history";
import {
  countChartLifecycle,
  countChartMounts,
  countRequests,
  countTextMutations,
  measureScroll,
  scrollAndMeasure,
  throttleCpu,
} from "./support/perf";

/**
 * Proof the harness itself works, against the CURRENT (unfixed) code.
 *
 * The bounds are deliberately loose. They say "the mocks match the real
 * contracts and the probes see the real work" — not "the page is fast". The
 * performance work tightens them; a number wildly outside these means the
 * fixture drifted from the app rather than that the app regressed.
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

  test("a reader who stops to look gets charts built for them", async ({ page }) => {
    await openHistory(page);

    // This case originally asserted the BUG — "a sweep mounts many charts",
    // `mounts > 10` — as proof the harness could see the problem. Once the
    // deferral landed it measured 0 and went red, which is a test asserting
    // that a fix has not happened. Rewritten to pin the half of the behaviour
    // that must survive forever: dwelling past the settle window DOES build
    // charts. Without this, "never mount anything" would pass every other spec
    // on this page while shipping a permanently blank dashboard.
    let frames = { fps: 0, longTasks: 0, blockedMs: 0, maxFrameMs: 0, durationMs: 0 };
    const restore = await throttleCpu(page, 4);
    const mounts = await countChartMounts(page, async () => {
      frames = await measureScroll(page, { seconds: 12, stepFraction: 0.5, dwellMs: 700 });
    });
    await restore();

    expect(mounts).toBeGreaterThan(3);
    expect(frames.fps).toBeGreaterThan(0);
    console.log(
      `[baseline] Live range, 4x CPU: ${frames.fps} fps · ${frames.longTasks} long tasks · ` +
        `${frames.blockedMs}ms blocked in ${frames.durationMs}ms · ${mounts} chart mounts`,
    );
  });

  test("a preset range under CPU throttle costs what the profile said", async ({ page }) => {
    const backend = await openHistory(page);

    await selectRange(page, "Last week");
    await expect(mountedCharts(page).first()).toBeVisible();
    expect(backend.requestCount("/api/history/rollup")).toBeGreaterThan(0);

    const restore = await throttleCpu(page, 4);
    // Dwelling, for the same reason as the case above: this asserts the harness
    // can still SEE a preset-range mount and its rollup fetch. It used to read
    // `chartMounts > 5` off a continuous sweep, which was the unfixed behaviour.
    const result = await scrollAndMeasure(page, {
      seconds: 12,
      stepFraction: 0.5,
      dwellMs: 700,
    });
    await restore();

    // Charts are built, and their rollup rows really are fetched per chart.
    expect(result.chartMounts).toBeGreaterThan(3);
    expect(result.fps).toBeGreaterThan(0);
    expect(result.maxFrameMs).toBeGreaterThan(0);
    expect(backend.requestCount("/api/history/rollup")).toBeGreaterThan(3);

    // The two-pass helper stays exercised too — implementers use both.
    const lifecycle = await countChartLifecycle(page, () => page.waitForTimeout(300));
    expect(lifecycle.mounts).toBeGreaterThanOrEqual(0);

    console.log(
      `[baseline] Last week, 4x CPU: ${result.fps} fps · ${result.longTasks} long tasks · ` +
        `${result.blockedMs}ms blocked in ${result.durationMs}ms · ` +
        `${result.chartMounts} mounts / ${result.chartUnmounts} unmounts`,
    );
  });
});
