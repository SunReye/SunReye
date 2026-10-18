import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ChartFullscreenFixture from "./chart-fullscreen.fixture.svelte";

afterEach(() => {
  document.body.style.pointerEvents = "";
});

/** What a real tap at the centre of `el` lands on — a synthetic click would not care. */
function tapReaches(el: Element): boolean {
  const box = el.getBoundingClientRect();
  return el.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
}

test("a chart in a dialog expands to the screen, not to the dialog, and stays usable", async () => {
  render(ChartFullscreenFixture);
  // bits-ui's scroll lock while a dialog is open; the dialog takes input back.
  document.body.style.pointerEvents = "none";

  const plot = page.getByTestId("plot").element();
  const before = plot.getBoundingClientRect().height;
  await page.getByRole("button", { name: "Full screen" }).click();

  // The transformed dialog would otherwise be the containing block of `fixed`.
  const frame = page.getByRole("heading", { name: "Forecast" }).element()
    .parentElement!.parentElement!;
  await expect.poll(() => frame.getBoundingClientRect().width).toBe(window.innerWidth);
  expect(frame.getBoundingClientRect().height).toBe(window.innerHeight);
  expect(plot.getBoundingClientRect().height).toBeGreaterThan(before);

  // Portalled to a body that refuses pointer input: the frame must take it back,
  // or the exit control paints and cannot be pressed.
  const exit = page.getByRole("button", { name: "Exit full screen" });
  expect(tapReaches(exit.element())).toBe(true);
  await exit.click();
  await expect.element(page.getByRole("button", { name: "Full screen" })).toBeVisible();
  expect(page.getByTestId("dialog").element().contains(plot)).toBe(true);
});
