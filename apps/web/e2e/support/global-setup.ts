import { chromium, type FullConfig } from "@playwright/test";

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
 * No API mocks are installed on purpose — the app's boot calls will simply fail
 * against no backend, which is fine: the point is to make Vite crawl and
 * pre-bundle the module graph, not to render a working dashboard.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use?.baseURL ?? "http://localhost:5199";
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    for (const route of ["/#/", "/#/history"]) {
      await page.goto(`${base}${route}`, { waitUntil: "networkidle", timeout: 120_000 });
    }
  } finally {
    await page.close();
    await browser.close();
  }
}
