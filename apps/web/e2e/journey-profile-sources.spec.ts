/**
 * JOURNEY: an admin brings in profiles the binary does not carry.
 *
 * On first-run setup the profile list holds the compiled-in profiles. The admin adds a source by
 * URL, then imports one profile file; both profiles join the list and either can be chosen.
 *
 * The sources editor's rules are `profile-sources-editor.svelte.test.ts`'s subject; what only a
 * running app proves is that the requests leave in the shape the core takes and the list the
 * profile step shows is the one the core answers next.
 */

import { expect, test } from "@playwright/test";
import { openPage } from "./support/open-page";

const IMPORTED = { id: "acme-imported", name: "Acme Imported", manufacturer: "Acme", metrics: [] };

test("a source by URL and an imported file both join the profile list and can be chosen", async ({
  page,
}) => {
  const opened = await openPage(page, "/#/setup", { live: false, needsProfile: true });
  await expect(page.getByText("Acme Fetched")).toHaveCount(0);
  // The footer names the profile the step will go on with.
  const chosen = page.locator("[data-setup-footer]");

  // ── 1. A source by URL ──────────────────────────────────────────────────
  await page.getByRole("button", { name: "Add a profile source" }).click();
  await page.getByLabel("Base URL").fill("https://profiles.example.org/repo");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("index.json · Profiles: 1")).toBeVisible();
  await expect(chosen).toContainText("Acme Fetched");

  // ── 2. One file ─────────────────────────────────────────────────────────
  await page.getByLabel("Profile file (.json)").setInputFiles({
    name: "acme-imported.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(IMPORTED)),
  });
  await expect(chosen).toContainText("Acme Imported");

  // ── 3. Both are in the list: the fetched one is the other "Select" in the Acme group ──
  await page.getByRole("button", { name: "Select", exact: true }).first().click();
  await expect(chosen).toContainText("Acme Fetched");

  const posts = opened.backend.writes.filter((w) => w.method === "POST");
  expect(posts.map((w) => [w.path, w.body])).toEqual([
    [
      expect.stringMatching(/\/api\/settings\/profile-sources$/),
      { baseUrl: "https://profiles.example.org/repo", indexPath: "index.json" },
    ],
    [expect.stringMatching(/\/api\/settings\/profiles\/import$/), IMPORTED],
  ]);
  expect(opened.consoleErrors).toEqual([]);
  expect(opened.backend.unhandled).toEqual([]);
});
