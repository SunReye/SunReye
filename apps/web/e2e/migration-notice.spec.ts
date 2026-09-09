import { expect, test } from "@playwright/test";
import { openPage } from "./support/open-page";

/**
 * The two shell states a half-finished 1.2.0 -> 2.0.0 migration creates.
 *
 * Both only exist in a RUNNING document, which is why they are here and not in a
 * source-text test: one is a navigation the shell performs after an async status
 * read resolves, and the other is a banner that appears above `main` on every
 * route and must NOT appear on the overwhelming majority of instances. A regex
 * over `+layout.svelte` would pass for both whether or not either worked.
 *
 * The banner is the deliverable that matters. The failure it exists to prevent is
 * silent: while the backfill is outstanding, every month-to-date and
 * year-to-date figure on screen covers a fraction of the window it names, and
 * nothing about the number says so.
 */

const CUTOVER = "2026-08-27T09:00:00.000Z";

/** Mid-migration, names confirmed, history not carried across: banner, no gate. */
const DEFERRED = {
  onboardingRequired: false,
  backfillOutstanding: true,
  banner: `History before ${CUTOVER} has not been migrated from the 1.2.0 database yet.`,
  historyFrom: CUTOVER,
} as const;

test.describe("the app-wide missing-history notice", () => {
  test("a healthy install shows no banner at all", async ({ page }) => {
    // The load-bearing default, and the reason this case comes first: this
    // endpoint is read on every page load of every instance, and a banner that
    // engaged by accident would sit above the dashboard of every existing user.
    const { backend, consoleErrors } = await openPage(page, "/#/");
    await expect(page.getByRole("status")).toHaveCount(0);
    expect(backend.unhandled).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("a deferred migration NAMES the missing span, above the page", async ({ page }) => {
    const { consoleErrors } = await openPage(page, "/#/", { migration: { ...DEFERRED } });
    const notice = page.getByRole("status");
    await expect(notice).toBeVisible();
    // The date, not "some history is missing": a sentence an operator cannot act
    // on is one they stop reading after a week.
    await expect(notice).toContainText("Aug 27");
    expect(consoleErrors).toEqual([]);
  });

  test("and it offers an admin the way to run it", async ({ page }) => {
    await openPage(page, "/#/", { migration: { ...DEFERRED }, role: "admin" });
    await expect(page.getByRole("button", { name: /Migrate now/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Remind me later/i })).toBeVisible();
  });

  test("a non-admin is TOLD but offered nothing they cannot do", async ({ page }) => {
    // Being unable to fix it is not a reason to be kept from knowing: a viewer
    // reading a partial month-to-date figure needs the sentence either way.
    await openPage(page, "/#/", { migration: { ...DEFERRED }, role: "user" });
    await expect(page.getByRole("status")).toContainText("Aug 27");
    await expect(page.getByRole("button", { name: /Migrate now/i })).toHaveCount(0);
  });

  test("a snoozed banner is gone, with the migration still outstanding", async ({ page }) => {
    await openPage(page, "/#/", { migration: { ...DEFERRED, bannerSnoozed: true } });
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("a running backfill says so instead of offering to start another", async ({ page }) => {
    await openPage(page, "/#/", {
      migration: { ...DEFERRED, backfillRunning: true },
      role: "admin",
    });
    await expect(page.getByRole("status")).toContainText(/Migrating history/i);
    await expect(page.getByRole("button", { name: /Migrate now/i })).toHaveCount(0);
  });
});

test.describe("the migration onboarding gate", () => {
  test("an unnamed plant DIVERTS the whole workspace to the form", async ({ page }) => {
    // Not a notice. Discovery is held until these two names exist, so the form is
    // the one screen that has to be finished — see
    // apps/server/src/migration/onboarding.ts.
    await openPage(page, "/#/", {
      migration: {
        onboardingRequired: true,
        backfillOutstanding: true,
        banner: DEFERRED.banner,
        historyFrom: CUTOVER,
        slugEditable: true,
        plantName: "My plant",
        deviceName: "SG05LP3",
        plantSlug: "my-plant",
        deviceSlug: "inverter",
      },
      role: "admin",
      live: false,
    });
    await expect(page).toHaveURL(/#\/migration$/);
  });

  test("the form pre-fills both names and shows the topic they will freeze into", async ({
    page,
  }) => {
    await openPage(page, "/#/migration", {
      migration: {
        onboardingRequired: true,
        slugEditable: true,
        plantName: "My plant",
        deviceName: "SG05LP3",
        plantSlug: "my-plant",
        deviceSlug: "inverter",
      },
      role: "admin",
      live: false,
    });
    await expect(page.getByLabel("Plant name")).toHaveValue("My plant");
    await expect(page.getByLabel("Device name")).toHaveValue("SG05LP3");
    // The consequence, before it is frozen. Derived on the client from the names,
    // by the port of the server's own `slugify` — see $lib/slug.ts.
    await expect(page.getByText("my-plant/inverter")).toBeVisible();
  });

  test("the preview FOLLOWS the name as it is typed", async ({ page }) => {
    // The whole reason the slug field exists. A preview that lagged the name would
    // show a consequence that is not the one about to happen, for a value that
    // lands in every MQTT topic and every entity id permanently.
    await openPage(page, "/#/migration", {
      migration: {
        onboardingRequired: true,
        slugEditable: true,
        plantName: "My plant",
        deviceName: "SG05LP3",
        plantSlug: "my-plant",
        deviceSlug: "inverter",
      },
      role: "admin",
      live: false,
    });
    await page.getByLabel("Plant name").fill("Haus Süd");
    // Folded, not stripped: "Süd" -> "sud", because a dropped umlaut makes a
    // German operator's topic unreadable. The device half does NOT move with its
    // own name — that slug is role-derived on purpose (see the page).
    await expect(page.getByText("haus-sud/inverter")).toBeVisible();
    await page.getByLabel("Device name").fill("Deye SG05LP3");
    await expect(page.getByText("haus-sud/inverter")).toBeVisible();
  });

  test("the identifiers are not editable once discovery has been announced", async ({ page }) => {
    await openPage(page, "/#/migration", {
      migration: {
        onboardingRequired: true,
        slugEditable: false,
        plantName: "My plant",
        deviceName: "SG05LP3",
        plantSlug: "my-plant",
        deviceSlug: "inverter",
      },
      role: "admin",
      live: false,
    });
    await expect(page.getByRole("button", { name: /Correct the identifiers/i })).toHaveCount(0);
    await expect(page.getByText(/already been announced/i)).toBeVisible();
  });
});
