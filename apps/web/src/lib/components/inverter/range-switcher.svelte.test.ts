import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import RangeSwitcher from "./range-switcher.svelte";

const FOUR = [
  { id: "today", label: "Today" },
  { id: "week", label: "Last 7 days" },
  { id: "month", label: "Last 30 days" },
  { id: "year", label: "Last 365 days" },
] as const;
const THREE = FOUR.slice(0, 3);

afterEach(async () => {
  await page.viewport(1280, 800);
});

// `includeHidden`: one of the two forms is always display:none, and the point
// is to assert which.
const radio = (name: string) => page.getByRole("radio", { name, exact: true, includeHidden: true });
const select = () => page.getByRole("combobox", { name: "Range", includeHidden: true });

describe("a four-option switcher on a phone", () => {
  test("offers a native select instead of a row that would wrap", async () => {
    await page.viewport(390, 844);
    render(RangeSwitcher, { options: FOUR, value: "today", label: "Range" });

    await expect.element(select()).toBeVisible();
    await expect.element(radio("Today")).not.toBeVisible();
  });

  test("the select and the row drive one value", async () => {
    await page.viewport(390, 844);
    render(RangeSwitcher, { options: FOUR, value: "today", label: "Range" });

    await select().selectOptions("year");
    // The row is hidden on a phone but is the same control from sm up; a
    // rotate must not show it disagreeing with the select.
    await expect.element(radio("Last 365 days")).toHaveAttribute("data-state", "on");
    await expect.element(radio("Today")).toHaveAttribute("data-state", "off");
  });
});

describe("from sm up", () => {
  test("the four-option row is back and the select is gone", async () => {
    render(RangeSwitcher, { options: FOUR, value: "today", label: "Range" });
    await expect.element(radio("Last 365 days")).toBeVisible();
    await expect.element(select()).not.toBeVisible();

    // Every option sits on one line.
    const tops = FOUR.map((o) => Math.round(radio(o.label).element().getBoundingClientRect().top));
    expect(new Set(tops).size).toBe(1);
  });

  test("a second press of the active option keeps it selected", async () => {
    render(RangeSwitcher, { options: FOUR, value: "week", label: "Range" });
    await radio("Last 7 days").click();
    await expect.element(radio("Last 7 days")).toHaveAttribute("data-state", "on");
  });
});

test("a three-option switcher keeps its row on a phone and renders no select", async () => {
  await page.viewport(390, 844);
  render(RangeSwitcher, { options: THREE, value: "today", label: "Range" });
  await expect.element(radio("Last 30 days")).toBeVisible();
  expect(page.getByRole("combobox").elements()).toHaveLength(0);
});
