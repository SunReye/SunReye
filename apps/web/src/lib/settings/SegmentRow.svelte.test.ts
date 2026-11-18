import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import SegmentRow from "./SegmentRow.svelte";

afterEach(async () => {
  await page.viewport(414, 896);
});

/** Bewegung's row, its status the longest it says. */
async function row() {
  const screen = await render(SegmentRow, {
    label: "Bewegung",
    value: "auto",
    options: [
      ["auto", "Automatisch"],
      ["full", "Voll"],
      ["lite", "Reduziert"],
    ],
    hint: "Auf diesem Gerät gemessen: Reduziert.",
    onchange: () => {},
  });

  const segments = screen.getByRole("group", { name: "Bewegung" }).element();

  // Unstyled, every part stacks: measure only once the row is laid out as a flex row.
  await expect
    .poll(() => getComputedStyle(segments.closest("[data-slot=item]")!).display)
    .toBe("flex");

  return {
    status: screen.getByText("Auf diesem Gerät gemessen: Reduziert.").element(),
    segments,
  };
}

test("on a phone, a row too narrow for its status beside the segments puts them below it", async () => {
  await page.viewport(390, 844);
  const { status, segments } = await row();

  expect(segments.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    status.getBoundingClientRect().bottom,
  );
});

test("on a wide screen, the segments sit beside the status", async () => {
  await page.viewport(1100, 900);
  const { status, segments } = await row();

  expect(segments.getBoundingClientRect().top).toBeLessThan(status.getBoundingClientRect().bottom);
});
