/**
 * JOURNEY: a user browses their history.
 *
 * Open History, step a day back and forward again, switch the grain to a week
 * and a month, step within the month, and read a value off a chart. Every
 * assertion is on what the user can see: the period title on the calendar
 * button, the Live pill that only the current period wears, the arrows' names
 * (they are named for the grain they step) and whether "next" is available.
 *
 * The window is NOT in the URL — the hash stays `#/history` throughout — so the
 * period title is the only place the page says which window it is showing, and
 * that is what this asserts. The exact window arithmetic (civil days, one
 * request per card, daily buckets on Year) is `history-period-step.spec.ts`'s
 * subject; this is the walk through it.
 */

import { expect, test } from "@playwright/test";
import { MANIFEST } from "./support/api-mock";
import { metricCards, mountedCharts, openHistory, periodNavigator } from "./support/history";

/** A value with a unit, as a chart tooltip prints one ("-964 W", "231.4 V"). */
const READING = /-?\d[\d,.]*\s?(W|kW|V|A|%|kWh|°C|Hz)\b/;

test.describe("journey: browse history", () => {
  test("steps the period, changes the grain, and reads a value off a chart", async ({ page }) => {
    const backend = await openHistory(page);
    const nav = periodNavigator(page);
    const grains = page.getByRole("group", { name: "Select time span" });

    // ── 1. Landing: History, on today, live ─────────────────────────────────
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("History");
    await expect(page).toHaveURL(/#\/history$/);
    await expect(nav.trigger).toContainText("Today");
    await expect(nav.trigger).toContainText("Live");
    await expect(nav.back).toHaveAccessibleName("Previous day");
    // Nothing after today to step into.
    await expect(nav.forward).toBeDisabled();
    await expect(metricCards(page).first()).toBeVisible();

    // ── 2. One day back: a dated title, no Live pill, "next" available ──────
    await nav.back.click();
    await expect(nav.trigger).not.toContainText("Today");
    await expect(nav.trigger).not.toContainText("Live");
    const yesterday = (await nav.trigger.innerText()).trim();
    expect(yesterday).toMatch(/\d/);
    await expect(nav.forward).toBeEnabled();
    await expect(nav.forward).toHaveAccessibleName("Next day");

    // Another step back moves the title again — it is a step, not a toggle.
    await nav.back.click();
    await expect(nav.trigger).not.toHaveText(yesterday);
    // …and forward retraces it.
    await nav.forward.click();
    await expect(nav.trigger).toHaveText(yesterday);
    await nav.forward.click();
    await expect(nav.trigger).toContainText("Today");
    await expect(nav.forward).toBeDisabled();

    // ── 3. Week grain ───────────────────────────────────────────────────────
    await grains.getByRole("button", { name: "Week", exact: true }).click();
    await expect(nav.trigger).toContainText("Week of");
    await expect(nav.back).toHaveAccessibleName("Previous week");
    await expect(nav.forward).toHaveAccessibleName("Next week");

    // ── 4. Month grain, then a month back ───────────────────────────────────
    await grains.getByRole("button", { name: "Month", exact: true }).click();
    await expect(nav.back).toHaveAccessibleName("Previous month");
    await expect(nav.trigger).toContainText("Live");
    const thisMonth = (await nav.trigger.innerText()).replace("Live", "").trim();
    // "Oct 2026" — a month and a year, whatever the locale's month name is.
    expect(thisMonth).toMatch(/\d{4}/);
    await expect(nav.forward).toBeDisabled();

    await nav.back.click();
    await expect(nav.trigger).not.toContainText("Live");
    await expect(nav.trigger).not.toContainText(thisMonth);
    await expect(nav.forward).toBeEnabled();
    // Still the History page, at the same address: the window lives in the title.
    await expect(page).toHaveURL(/#\/history$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("History");

    // ── 5. Read a value off a chart ─────────────────────────────────────────
    const chart = mountedCharts(page).first();
    await expect(chart).toBeVisible();
    const tooltip = page.locator(".lc-tooltip-root");
    await expect(tooltip).toHaveCount(0);
    const box = await chart.boundingBox();
    if (!box) throw new Error("the first chart has no layout box");
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await expect(tooltip.first()).toBeVisible();
    // A metric's name as the profile labels it, and a value with its unit.
    const text = await tooltip.first().innerText();
    expect(MANIFEST.metrics.some((m) => text.includes(m.label))).toBe(true);
    expect(text).toMatch(READING);
    // Moving off the chart puts the readout away again.
    await page.mouse.move(box.x + box.width / 2, Math.max(0, box.y - 120));
    await expect(tooltip).toHaveCount(0);

    expect(backend.socketOpens).toBe(1);
    expect(backend.unhandled).toEqual([]);
  });
});
