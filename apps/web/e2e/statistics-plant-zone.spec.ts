/**
 * /statistics asks for the PLANT's days, whatever zone the browser is in.
 *
 * The server sums energy and cost on the plant's calendar (its zone, resolved
 * server-side). A viewer in New York looking at a Berlin plant used to build
 * every window on New York midnights — six hours off every Berlin day, so each
 * "day" the tiles priced was the evening of one plant day and most of the next.
 * The plant's zone rides on `GET /api/sources` (any session may read it); the
 * page builds its windows on it once it lands.
 *
 * The browser is put in New York with Playwright's `timezoneId`, the mocked
 * source list says Berlin, and the assertion is on the windows the page puts on
 * the wire: read on Berlin's clock they start at 00:00.
 */

import { expect, test, type Page } from "@playwright/test";
import * as fixture from "./support/api-fixtures";
import { periodNavigator } from "./support/history";
import { openPage } from "./support/open-page";

test.use({ timezoneId: "America/New_York" });

const PLANT = "Europe/Berlin";

/** Wall-clock `HH:MM` of `iso` in `timeZone`. */
function wallTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** The `from` of every request to `path` so far, in order. */
function fromsOf(requests: readonly string[], path: string): string[] {
  return requests
    .filter((r) => r.startsWith(`/api/${path}?`))
    .map((r) => new URLSearchParams(r.slice(r.indexOf("?") + 1)).get("from") ?? "");
}

function dayTab(page: Page) {
  const row = page.getByRole("group", { name: "Select time span" });
  return row
    .getByRole("radio", { name: "Day", exact: true })
    .or(row.getByRole("button", { name: "Day", exact: true }));
}

test("statistics windows open on the plant's midnights, not the browser's", async ({ page }) => {
  const opened = await openPage(page, "/#/statistics", {
    sources: { ...fixture.SOURCES, plant: { ...fixture.SOURCES.plant, timeZone: PLANT } },
  });
  const { backend } = opened;

  // The month tab the page opens on, once the plant's zone has landed.
  await expect
    .poll(() => fromsOf(backend.requests, "statistics/comparison").at(-1) ?? "")
    .not.toBe("");
  await expect
    .poll(() => wallTime(fromsOf(backend.requests, "statistics/comparison").at(-1)!, PLANT))
    .toBe("00:00");

  // The Day tab: the priced window and its hourly detail chart both start at
  // Berlin midnight, which on the browser's own clock is the evening before.
  backend.resetRequests();
  await dayTab(page).click();
  await expect.poll(() => fromsOf(backend.requests, "statistics/comparison").length).toBe(1);
  const [from] = fromsOf(backend.requests, "statistics/comparison");
  expect(wallTime(from!, PLANT)).toBe("00:00");
  expect(wallTime(from!, "America/New_York")).not.toBe("00:00");

  await expect
    .poll(() =>
      backend.requests
        .filter((r) => r.includes("bucket=hour"))
        .map((r) => new URLSearchParams(r.slice(r.indexOf("?") + 1)).get("from") ?? "")
        .map((f) => wallTime(f, PLANT)),
    )
    .toContain("00:00");
  expect(opened.consoleErrors).toEqual([]);
});

/** `YYYY-MM-DD HH:MM` of `iso` in `timeZone`. */
function wallDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

test("a New York evening opens on the plant's CURRENT month, not the one it names", async ({
  page,
}) => {
  // 20:00 on 31 Aug in New York is 02:00 on 1 Sep in Berlin. The page opens on
  // "this month" — New York's August. Re-read by name that is Berlin's August,
  // which has already ended: the reader asked for live and got last month.
  await page.clock.install({ time: new Date("2026-09-01T00:00:00Z") });
  const opened = await openPage(page, "/#/statistics", {
    sources: { ...fixture.SOURCES, plant: { ...fixture.SOURCES.plant, timeZone: PLANT } },
  });
  const { backend } = opened;

  await expect
    .poll(() => fromsOf(backend.requests, "statistics/comparison").at(-1) ?? "")
    .not.toBe("");
  await expect
    .poll(() => wallDate(fromsOf(backend.requests, "statistics/comparison").at(-1)!, PLANT))
    .toBe("2026-09-01 00:00");
  const nav = periodNavigator(page);
  await expect(nav.trigger).toContainText("Live");
  await expect(nav.forward).toBeDisabled();

  // The calendar behind the trigger opens on the plant's month too — its days
  // are read in the plant's zone, so August is a month the plant has left.
  await nav.trigger.click();
  const inMonth = page.locator("[data-bits-day]:not([data-outside-month])");
  await expect(inMonth.first()).toHaveAttribute("data-value", "2026-09-01");

  // …and the today ring sits on the PLANT's today. The browser's is 31 Aug.
  const ringed = page.locator("[data-bits-day][data-plant-today]");
  await expect(ringed).toHaveCount(1);
  await expect(ringed).toHaveAttribute("data-value", "2026-09-01");
  await expect(ringed).toHaveCSS("box-shadow", /inset/);
  const browserToday = page.locator("[data-bits-day][data-value='2026-08-31']");
  await expect(browserToday).not.toHaveCSS("box-shadow", /inset/);
  expect(opened.consoleErrors).toEqual([]);
});
