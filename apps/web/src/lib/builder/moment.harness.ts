// Shared by the builder's component tests: picking a day, scrubbing the time and saving from a day.
import { toast } from "svelte-sonner";
import { expect, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { starts } from "./builder.harness.ts";

/** Picks `day` (`YYYY-MM-DD`) in the calendar of the day button labelled `label`. */
export async function pickDay(label: string, day: string): Promise<void> {
  const [year = 0, month = 0] = day.split("-").map(Number);

  await page.getByRole("button", { name: starts(`${label}: `) }).click();

  const calendar = page.getByRole("application", { name: starts(`${label} `) });

  await expect.element(calendar).toBeVisible();

  // The year first, as it may limit the months; the caption is drawn anew after it.
  await userEvent.selectOptions(calendar.getByLabelText("Select a year"), String(year));
  await userEvent.selectOptions(calendar.getByLabelText("Select a month"), String(month));

  const cell = calendar
    .element()
    .querySelector(`[data-value="${day}"]:not([data-outside-month]) > *`);

  if (cell === null) throw new Error(`no day ${day}`);

  await userEvent.click(cell);
  await expect.poll(() => calendar.query()).toBeNull();
}

/** Scrubs the time slider to `minutes` since midnight, a quarter hour per arrow key. */
export async function scrub(minutes: number): Promise<void> {
  const slider = page.getByRole("slider", { name: "Uhrzeit" });
  const thumb = slider.element();
  const steps = (minutes - Number(thumb.getAttribute("aria-valuenow"))) / 15;

  if (!(thumb instanceof HTMLElement)) throw new TypeError("no slider thumb");

  thumb.focus();

  if (steps !== 0) {
    await userEvent.keyboard((steps < 0 ? "{ArrowLeft}" : "{ArrowRight}").repeat(Math.abs(steps)));
  }

  await expect.element(slider).toHaveAttribute("aria-valuenow", String(minutes));
}

export async function saveFrom(day: string): Promise<void> {
  await pickDay("Gilt ab", day);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
}

/** Saves from `day` and waits for the toast that confirms it (ADR 21). */
export async function savedFrom(day: string): Promise<void> {
  const success = vi.spyOn(toast, "success");

  success.mockClear();
  await saveFrom(day);
  await expect.poll(() => success.mock.calls.at(-1)?.[0]).toBe("Gespeichert.");
  expect(page.getByRole("status").query()).toBeNull();
}
