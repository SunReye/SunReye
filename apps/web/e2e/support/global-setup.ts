import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, type FullConfig } from "@playwright/test";
import { mockBackend } from "./api-mock";
import { discoverPageFiles, hashUrlFor } from "./open-page";

/**
 * Fail unless the dev server on `base` is serving THIS checkout.
 *
 * `webServer.reuseExistingServer` is on outside CI, and the port is pinned with
 * `--strictPort`, so whatever already holds it gets adopted silently. A stale
 * `vite dev` left running in another git worktree therefore served every page
 * of a whole suite run — including one that reported 43 green — while the specs
 * believed they were testing the branch on disk. Nothing in the run says so:
 * the pages render, the mocks fire, the assertions pass, and they pass against
 * somebody else's source.
 *
 * Vite's `server.fs.allow` defaults to the serving project's workspace root, so
 * an absolute `/@fs/` path INSIDE this checkout is the identity probe: 200 from
 * a server rooted here, 403 from one rooted anywhere else. (Verified both ways:
 * a `vite dev` rooted outside this tree answers 403 for exactly this URL.)
 */
async function assertServesThisCheckout(base: string): Promise<void> {
  // A file this suite already depends on existing, so the probe cannot rot into
  // a false alarm on its own.
  const marker = fileURLToPath(new URL("../../src/lib/api.ts", import.meta.url));
  if (!existsSync(marker)) {
    throw new Error(`e2e origin probe: marker file is gone (${marker}) — update global-setup.ts`);
  }
  const probe = `${base}/@fs${marker}`;
  const response = await fetch(probe).catch((cause: unknown) => {
    throw new Error(`e2e origin probe: no dev server answered ${probe} (${String(cause)})`);
  });
  if (response.ok) return;
  throw new Error(
    `e2e origin probe: the server on ${base} answered ${response.status} for this checkout's ` +
      `own source (${marker}). It is a Vite dev server rooted somewhere ELSE — almost certainly ` +
      `one left running by another worktree, which reuseExistingServer then adopted. The whole ` +
      `suite would have run against that tree's app code. Stop it, or run with a free port.`,
  );
}

/**
 * Warm Vite's dependency optimizer before any spec measures anything.
 *
 * The dev server bundles a dependency the first time a page actually imports
 * it, and then FULL-RELOADS the document ("[vite] connecting… / connected").
 * Landing inside a 12-second measured sweep, that reload was observed as three
 * `framenavigated` events mid-run: the probes are torn down with the document,
 * so the numbers the suite then asserts on are measured across a page that
 * restarted underneath them.
 *
 * Loading every route once here pays that cost where nothing is watching. It is
 * cheaper than the alternative (measuring a production build) and it keeps the
 * suite honest about what it is timing.
 *
 * The fake backend IS installed here, unlike in the first version of this file.
 * Warming two routes against no backend was harmless; warming all twenty-six is
 * not — an unanswered `(app)` boot never settles, so `networkidle` on `/#/costs`
 * simply ran out its two-minute budget and failed the whole run before a single
 * spec started. With the mock in place each route settles in a second or two,
 * which is also a better warm-up: the module graph a RENDERED page pulls in is
 * the one the specs then measure.
 *
 * Each route's wait is still best-effort. A page that never goes idle (a poll,
 * a retry) must not fail the suite — the work of pre-bundling is already done by
 * the time it would matter.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use?.baseURL ?? "http://localhost:5199";
  await assertServesThisCheckout(base);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    // No automatic feed: a 1 Hz socket is irrelevant to dep optimization.
    await mockBackend(page, { feedIntervalMs: 0 });
    // A budget for the whole PHASE rather than a tighter one per route. A
    // healthy app warms all 26 in ~10s and never comes near this; a broken one
    // — a shell in a re-lease loop never reaches `networkidle` — used to burn
    // 144s here before the first spec could name the fault, which made the
    // slowest feedback loop the one you hit when something is actually wrong.
    // Cutting the per-route budgets instead would have cost the warm-up its
    // whole point on a slow first compile.
    const deadline = Date.now() + 60_000;
    for (const route of discoverPageFiles().map(hashUrlFor)) {
      if (Date.now() > deadline) break;
      // Both waits swallow their own timeout. Warming is best-effort by
      // definition, and a route that never settles must not be able to fail
      // the whole run before a spec has said anything — which is exactly what
      // happened the first time a stub went missing.
      await page.goto(`${base}${route}`, { timeout: 20_000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    }
  } finally {
    await page.close();
    await browser.close();
  }
}
