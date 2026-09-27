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
