// Explore's header on a phone (ADR 21): below 415 px the title, then its controls across the width.
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
// The screen is laid out by the SPA's utilities.
import "../../app.css";
import { reset, show } from "./explore.harness.ts";

afterEach(reset);

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM, only measured.
const box = (element: Element) => element.getBoundingClientRect();

/** Where each part of the header stands. */
function header() {
  return {
    title: box(page.getByRole("heading", { name: "Erkunden", level: 1 }).element()),
    exported: box(page.getByRole("button", { name: "Als CSV exportieren" }).element()),
    full: box(page.getByRole("button", { name: "Vollbild" }).element()),
    // The range's row spans the header.
    row: box(
      page.getByRole("heading", { name: "Erkunden", level: 1 }).element().closest("header")!,
    ),
  };
}

test("on a phone below 415 px the title stands alone and its controls span the width under it", async () => {
  await page.viewport(390, 844);

  const { screen } = await show();

  await expect.element(screen.getByRole("heading", { name: "Erkunden", level: 1 })).toBeVisible();
  const { title, exported, full, row } = header();

  expect(exported.top).toBeGreaterThanOrEqual(title.bottom);
  expect(exported.left).toBe(row.left);
  expect(full.right).toBe(row.right);
  // The words stay.
  await expect.element(screen.getByText("Überlagern")).toBeVisible();
  expect(document.documentElement.scrollWidth).toBe(390);
});

test("from 415 px the title and its controls share one row", async () => {
  await page.viewport(430, 844);

  const { screen } = await show();

  await expect.element(screen.getByRole("heading", { name: "Erkunden", level: 1 })).toBeVisible();
  const { title, exported } = header();

  expect(exported.top).toBeLessThan(title.bottom);
  expect(exported.bottom).toBeGreaterThan(title.top);
});
