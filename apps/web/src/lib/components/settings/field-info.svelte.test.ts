import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import FieldInfo from "./field-info.svelte";

test("an icon-only trigger names its field for a screen reader", async () => {
  render(FieldInfo, { label: "Feed-in limit", info: "Caps export at the meter." });

  await expect.element(page.getByRole("button", { name: /Feed-in limit/ })).toBeVisible();
});

test("keeps the explanation behind a tap", async () => {
  render(FieldInfo, { label: "Feed-in limit", info: "Caps export at the meter." });

  await expect.element(page.getByText("Caps export at the meter.")).not.toBeInTheDocument();
  await page.getByRole("button", { name: /Feed-in limit/ }).click();
  await expect.element(page.getByText("Caps export at the meter.")).toBeVisible();
});

test("meets the 44px tap floor although the icon is 14px", async () => {
  render(FieldInfo, { label: "Feed-in limit", info: "Caps export at the meter." });

  // TAP widens the hit area with a pseudo-element, which a bounding box does not
  // see — so ask the document what a tap 20px off the icon's centre lands on.
  const trigger = page.getByRole("button", { name: /Feed-in limit/ }).element();
  trigger.parentElement!.style.padding = "40px";
  const box = trigger.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  for (const [dx, dy] of [
    [20, 0],
    [-20, 0],
    [0, 20],
    [0, -20],
  ] as const) {
    expect(trigger.contains(document.elementFromPoint(cx + dx, cy + dy))).toBe(true);
  }
});
