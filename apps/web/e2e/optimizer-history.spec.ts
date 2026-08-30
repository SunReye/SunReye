/**
 * THE DECISION CHARTS READ THE OPTIMIZER'S STORED SERIES (#172).
 *
 * A browser spec because everything it claims only exists in a running
 * document: which requests the page issues, whether a socket frame turns into a
 * second request, and whether the plots mount off the answer. A source-text
 * regex over the fetcher would pass for a page that never mounts the section and
 * fail for a rename — see `apps/web/TESTING.md`.
 *
 * What it is written against, concretely:
 *
 *  - the decisions must be asked for BY SLUG. Without `inverterId=optimizer` the
 *    read path answers for the plant's default source, and `optimizer.*` on an
 *    inverter is an empty series — a chart section that silently shows its empty
 *    state on a plant whose optimizer is working perfectly.
 *  - a new tick must cost exactly ONE refresh. The frame carries a `lastTickAt`
 *    stamp rather than a signal precisely so that a reconnect replaying the same
 *    frame costs nothing; a page that latched a boolean instead would refetch on
 *    every reconnect, and one that refetched per frame would issue five requests
 *    per tick (one per optimizer series) forever.
 */
import { expect, type Page, test } from "@playwright/test";
import { automationStream } from "./support/api-fixtures";
import { rollupCalls } from "./support/history";
import { openPage } from "./support/open-page";
import { SELECTORS } from "./support/perf";

/** The section card whose H2 is `title` — the same probe page-smoke uses. */
const sectionNamed = (page: Page, title: string | RegExp) =>
  page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: title }) })
    .last();

const PEAK_SHAVING = "/#/automations/peak-shaving";

/** The five series the optimizer itself declares, as the charts ask for them. */
const DECISION_METRICS = [
  "optimizer.target.current",
  "optimizer.applied.current",
  "optimizer.threshold.power",
  "optimizer.local.sink.power",
  "optimizer.state",
];

/** Every rollup call for an `optimizer.*` metric, with the slug it named. */
function decisionCalls(requests: readonly string[]) {
  return requests
    .filter((r) => r.startsWith("/api/history/rollup?"))
    .map((r) => new URLSearchParams(r.slice(r.indexOf("?") + 1)))
    .filter((q) => (q.get("metric") ?? "").startsWith("optimizer."))
    .map((q) => ({
      metric: q.get("metric") ?? "",
      inverterId: q.get("inverterId"),
      bucket: q.get("bucket") ?? "",
    }));
}

test("the optimizer's decisions are fetched by slug, and both plots mount", async ({ page }) => {
  const { backend } = await openPage(page, PEAK_SHAVING);

  const charts = sectionNamed(page, "Decision history");
  await expect(charts.locator(SELECTORS.chart)).toHaveCount(2, { timeout: 15_000 });

  const calls = decisionCalls(backend.requests);
  // A SET: the engine keeps ticking while the page loads and each tick is one
  // more refresh, so the count is a moving target and the vocabulary is not.
  expect([...new Set(calls.map((c) => c.metric))].sort()).toEqual([...DECISION_METRICS].sort());
  // BY SLUG. Without it the plant's default source answers, and `optimizer.*` on
  // an inverter is an empty series — an empty chart on a working plant.
  expect(calls.every((c) => c.inverterId === "optimizer")).toBe(true);
  // The minute tier is what lets a decision be joined to the plant's own
  // readings: two devices, two cadences, one set of bucket timestamps.
  expect(calls.every((c) => c.bucket === "minute")).toBe(true);
});

test("a new decision refreshes the charts exactly once; a repeated frame costs nothing", async ({
  page,
}) => {
  const { backend } = await openPage(page, PEAK_SHAVING);
  const charts = sectionNamed(page, "Decision history");
  await expect(charts.locator(SELECTORS.chart)).toHaveCount(2, { timeout: 15_000 });

  // The mock's own feed keeps ticking, and every tick is legitimately a
  // refresh — so the window this measures has to be quiet first.
  backend.stopFeed();
  // One frame to settle on, then the SAME OBJECT again. Rebuilding the fixture
  // would stamp a fresh `lastTickAt` and describe a second decision, which is
  // not what a reconnect replaying its snapshot does.
  const frame = automationStream();
  await backend.pushAutomations(frame);
  await page.waitForTimeout(1000);
  backend.resetRequests();

  await backend.pushAutomations(frame);
  await page.waitForTimeout(1000);
  expect(decisionCalls(backend.requests)).toEqual([]);

  // A tick. One refresh: one request per declared series, and no more.
  await backend.pushAutomations({
    ...frame,
    status: {
      ...frame.status,
      lastTickAt: new Date(Date.parse(frame.status.lastTickAt!) + 30_000).toISOString(),
    },
  });
  await expect
    .poll(() => decisionCalls(backend.requests).length, { timeout: 5000 })
    .toBe(DECISION_METRICS.length);
  await page.waitForTimeout(500);
  expect(decisionCalls(backend.requests)).toHaveLength(DECISION_METRICS.length);
});

test("the plan's measured day comes off the plant's own series, not the optimizer's", async ({
  page,
}) => {
  // The "Today" view joins what happened to what is planned. The measured half
  // is the PLANT'S history — `pv.total.power` and friends on the inverter — and
  // asking the optimizer for it would return nothing at all.
  const { backend } = await openPage(page, PEAK_SHAVING);
  backend.resetRequests();

  // The switcher is a real radiogroup, not a row of buttons — see
  // `range-switcher.svelte` on why.
  await sectionNamed(page, "Plan").getByRole("radio", { name: "Today", exact: true }).click();

  await expect
    .poll(() => rollupCalls(backend).filter((c) => !c.metric.startsWith("optimizer.")).length, {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  const plantCalls = rollupCalls(backend).filter((c) => !c.metric.startsWith("optimizer."));
  expect(plantCalls.every((c) => c.bucket === "minute")).toBe(true);
});
