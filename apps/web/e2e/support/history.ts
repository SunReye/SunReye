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
 * Pick a range preset by its visible label, e.g. `Live`, `24 hours`,
 * `Last week`. Waits for the picker to close so the caller measures the page,
 * not the popover animation.
 */
export async function selectRange(page: Page, label: string): Promise<void> {
  const trigger = page.getByRole("group", { name: "Select range" }).getByRole("button").nth(1);
  await trigger.click();
  // The popover content is portalled to the end of the body, so the preset is
  // the LAST button carrying that label — the first is the trigger, which is
  // still showing the range being replaced.
  await page.getByRole("button", { name: label, exact: true }).last().click();
  await expect(trigger).toHaveText(new RegExp(label));
}
