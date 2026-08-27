/**
 * Driving /history: the two or three gestures every perf spec starts with.
 *
 * Kept out of the specs so that a markup change costs one edit here rather than
 * one per spec, and so no spec has to know that the app is a hash router or
 * that the range picker lives behind a popover.
 */

import { expect, type Locator, type Page } from "@playwright/test";
import { type BackendOptions, mockBackend, type MockBackend } from "./api-mock";
import { SELECTORS } from "./perf";

/**
 * Mock the backend, open /history, and wait until the live socket is running
 * and the first card is on screen. Returns the backend so the spec can drive
 * the feed and read request counts.
 */
export async function openHistory(page: Page, options: BackendOptions = {}): Promise<MockBackend> {
  const backend = await mockBackend(page, options);
  // Hash router (`router.type: 'hash'`, ssr off) — routes are `/#/history`.
  await page.goto("/#/history");
  await backend.waitForLive();
  await expect(metricCards(page).first()).toBeVisible();
  return backend;
}

/** Every metric card's plot box — skeleton or mounted chart alike. */
export function metricCards(page: Page): Locator {
  return page.locator(SELECTORS.metricCard);
}

/** Charts currently built (layerchart roots in the DOM). */
export function mountedCharts(page: Page): Locator {
  return page.locator(SELECTORS.chart);
}

/**
 * The period navigator, as its two accessible groups.
 *
 * The control is one component on both /history and /statistics: four grain tabs
 * in a group named "Select time span", then `‹ 📅 title ›` in a group named
 * "Select range". Addressed through those names rather than by position in the
 * toolbar, so adding a control beside it does not move these locators.
 */
export function periodNavigator(page: Page) {
  const row = arrowRow(page);
  return {
    tab: (name: string) => grainTabs(page).getByRole("button", { name, exact: true }),
    // POSITIONAL inside the arrow row, not by name: the arrows are named for the
    // grain they step ("Previous month", "Vorherige Woche" — see `stepLabels`),
    // so a name-based locator would have to re-derive the label of the very tab
    // the spec just clicked, in the spec's locale. First and last of the three
    // controls in the row; the trigger is the one between them.
    back: row.getByRole("button").first(),
    forward: row.getByRole("button").last(),
    /** The calendar button. Its text is the period title, plus the live pill. */
    trigger: rangeTrigger(page),
  };
}

/** The `‹ 📅 title ›` row's own group. */
function arrowRow(page: Page): Locator {
  return page.getByRole("group", { name: "Select range" });
}

/** The four grain tabs' own group. */
function grainTabs(page: Page): Locator {
  return page.getByRole("group", { name: "Select time span" });
}

/** The calendar button: the middle of the three controls in the arrow row. */
function rangeTrigger(page: Page): Locator {
  return arrowRow(page).getByRole("button").nth(1);
}

/** The grain tabs, by the label each carries in English. */
const GRAIN_TAB_LABELS: readonly string[] = ["Day", "Week", "Month", "Year"];

/**
 * Preset labels the perf specs ask for, and the grain tab that now IS that
 * window.
 *
 * Those specs name a window SIZE — "a week of minute rollups", which is what
 * makes a mount cost what it costs — and the period navigator deleted the
 * rolling presets that used to be how you asked for one, because a calendar week
 * is a week and a calendar month is a month. Mapped here rather than in the three
 * specs so the claim each of them makes stays about the page and not about which
 * control produced the range.
 */
const REPLACED_BY_TAB: Record<string, string> = {
  "24 hours": "Day",
  "Last week": "Week",
  "Last month": "Month",
  "Last 12 months": "Year",
};

/**
 * Put the page on `label`'s window: a grain tab, or one of the kept presets
 * behind the calendar button.
 *
 * Waits until the control's own title has changed, so the caller measures the
 * page and not the popover animation.
 */
export async function selectRange(page: Page, label: string): Promise<void> {
  const trigger = rangeTrigger(page);
  const before = (await trigger.textContent()) ?? "";
  const tab = GRAIN_TAB_LABELS.includes(label) ? label : REPLACED_BY_TAB[label];

  if (tab) {
    await grainTabs(page).getByRole("button", { name: tab, exact: true }).click();
    // The title, not the tab's own paint: a tab that lit up without moving the
    // range would satisfy an attribute check and change nothing on the page.
    await expect(trigger).not.toHaveText(before);
    return;
  }

  await trigger.click();
  // The popover content is portalled to the end of the body, so the preset is
  // the LAST button carrying that label — the first is the trigger, which is
  // still showing the range being replaced.
  await page.getByRole("button", { name: label, exact: true }).last().click();
  await expect(trigger).toHaveText(new RegExp(label));
}

/** One `/api/history/rollup` call's query, as the mock recorded it. */
export interface RollupCall {
  metric: string;
  from: string;
  to: string;
  bucket: string;
}

/** Every rollup call the backend has seen, in order. */
export function rollupCalls(backend: MockBackend): RollupCall[] {
  return backend.requests
    .filter((r) => r.startsWith("/api/history/rollup?"))
    .map((r) => new URLSearchParams(r.slice(r.indexOf("?") + 1)))
    .map((q) => ({
      metric: q.get("metric") ?? "",
      from: q.get("from") ?? "",
      to: q.get("to") ?? "",
      bucket: q.get("bucket") ?? "",
    }));
}
