/**
 * /history asks for the PLANT's days, whatever zone the browser is in.
 *
 * The daily and monthly rollups behind every card are plant-calendar buckets.
 * A viewer in New York looking at a Berlin plant used to get New York
 * midnights — every "day" was the evening of one plant day and most of the
 * next. The plant's zone rides on `GET /api/sources`; the page re-reads the
 * period it stands on once that lands (`rezoneStandingPeriod`).
 *
 * The clock is pinned to 20:00 in New York, which is already 02:00 tomorrow in
 * Berlin: the day the reader opened on is the live one, so it has to become
 * the PLANT's live day, not the Berlin day that shares New York's date.
 */

import { expect, test } from "@playwright/test";
import * as fixture from "./support/api-fixtures";
import { mountedCharts, openHistory, periodNavigator, rollupCalls } from "./support/history";

test.use({ timezoneId: "America/New_York" });

const PLANT = "Europe/Berlin";
const NOW = new Date("2026-08-21T00:00:00Z"); // 20 Aug 20:00 New York, 21 Aug 02:00 Berlin

/** `YYYY-MM-DD HH:MM` of `iso` in `timeZone`. */
function wall(iso: string, timeZone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

test("history day windows open on the plant's midnights, not the browser's", async ({ page }) => {
  await page.clock.install({ time: NOW });
  const backend = await openHistory(page, {
    sources: { ...fixture.SOURCES, plant: { ...fixture.SOURCES.plant, timeZone: PLANT } },
  });
  const nav = periodNavigator(page);
  await expect(mountedCharts(page).first()).toBeVisible();

  // The opening day, once the zone has landed: Berlin's live 21 Aug.
  await expect.poll(() => rollupCalls(backend).at(-1)?.from ?? "").not.toBe("");
  await expect.poll(() => wall(rollupCalls(backend).at(-1)!.from, PLANT)).toBe("2026-08-21 00:00");
  const today = rollupCalls(backend).at(-1)!;
  expect(wall(today.to, PLANT)).toBe("2026-08-22 00:00");
  expect(wall(today.from, "America/New_York")).not.toMatch(/ 00:00$/);
  await expect(nav.trigger).toContainText("Live");
  await expect(nav.forward).toBeDisabled();

  // One step back is Berlin's previous civil day.
  backend.resetRequests();
  await nav.back.click();
  await expect(nav.forward).toBeEnabled();
  await expect.poll(() => rollupCalls(backend).length).toBeGreaterThan(0);
  const [yesterday] = rollupCalls(backend);
  expect(wall(yesterday!.from, PLANT)).toBe("2026-08-20 00:00");
  expect(wall(yesterday!.to, PLANT)).toBe("2026-08-21 00:00");
  expect(backend.unhandled).toEqual([]);
});
