/**
 * The calendar's today marker must not read as a selected day.
 *
 * The bug, from /statistics with a live backend: the user picks Aug 16 alone.
 * The trigger reads "Aug 16 – Aug 16" — the model is right — but the grid paints
 * Aug 16 AND Aug 18 (today) in the same solid blue with the same white text, so
 * the picked window reads as two days. The cause is a token collision in
 * `src/app.css`: `--accent` and `--primary` are byte-identical in `:root` and in
 * `.dark`, and the vendored shadcn day components paint today with `bg-accent`
 * and range endpoints with `bg-primary`.
 *
 * WHY THIS SPEC READS COMPUTED COLOUR, AND MUST KEEP DOING SO
 * ----------------------------------------------------------
 * The obvious DOM assertion — "exactly one day carries `data-selected`" — is
 * worthless here: it PASSES ON THE BROKEN BUILD. bits-ui is not confused. The
 * phantom cell has `data-today data-focused` and NO `data-selected`; the model,
 * the ARIA and the trigger label are all correct. The defect exists only in
 * pixels, so the only assertion that can see it is one that resolves the
 * cascade. Anyone "simplifying" this back to an attribute count is deleting the
 * coverage and leaving a green test behind.
 *
 * For the same reason the assertions name no class and no token. A fix that
 * spells today's treatment differently — ring, outline, muted fill — is still a
 * fix; a fix that leaves the two indistinguishable is not. The token collision
 * itself is pinned separately and cheaply by
 * `src/lib/components/ui/calendar-marker-tokens.test.ts`, which exists because
 * these are vendored files a future `shadcn-svelte add` regenerates.
 */

import { expect, type Locator, test } from "@playwright/test";
import { openPage, openRangePicker } from "./support/open-page";

/**
 * What a day cell actually paints.
 *
 * `backgroundColor` is read on its own for the today-vs-selected claim because
 * it is the only property the bug is made of, and it is the one property that
 * cannot be perturbed by focus: clicking a day gives it DOM focus, the day class
 * carries `focus:ring-ring/50 focus:border-ring`, and a whole-signature compare
 * would therefore find the two cells "different" on the BROKEN build — passing
 * for the wrong reason. The rest of the signature is only used against a plain,
 * unfocused day, where it is safe and where it catches the other way to make
 * this test green wrongly: deleting today's treatment altogether.
 */
async function paintOf(cell: Locator) {
  return cell.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      background: style.backgroundColor,
      color: style.color,
      boxShadow: style.boxShadow,
      outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
      border: `${style.borderTopStyle} ${style.borderTopWidth} ${style.borderTopColor}`,
    };
  });
}

/**
 * A day in today's month that is NOT today, biased into the past so the picked
 * window is a range the statistics page would really be asked for. Near the
 * start of a month there is no room behind today, so it steps forward instead.
 */
function neighbourOf(todayIso: string): string {
  const [year, month, day] = todayIso.split("-").map(Number);
  const target = day > 3 ? day - 2 : day + 2;
  return `${year}-${String(month).padStart(2, "0")}-${String(target).padStart(2, "0")}`;
}

test("a one-day pick paints one day: today is not dressed as the selection", async ({ page }) => {
  await openPage(page, "/#/statistics");

  const picker = await openRangePicker(page);
  const todayIso = await picker.today.getAttribute("data-value");
  expect(todayIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const pickedIso = neighbourOf(todayIso ?? "");

  // The reported gesture exactly: the same day clicked twice is a one-day range,
  // which fires the picker's `$effect` and closes the popover. Reopening is how
  // the user sees the grid they complained about.
  await picker.day(pickedIso).click();
  await picker.day(pickedIso).click();
  await expect(picker.today).toBeHidden();

  const reopened = await openRangePicker(page);
  const selected = reopened.day(pickedIso);
  await expect(selected).toHaveAttribute("data-selected", "");
  // bits-ui is not confused — this is the assertion that passes on the broken
  // build, kept only to prove the phantom is purely visual.
  await expect(reopened.today).not.toHaveAttribute("data-selected", "");

  const todayPaint = await paintOf(reopened.today);
  const selectedPaint = await paintOf(selected);

  // THE BUG. Broken build: both are oklch(0.488 0.243 264.376).
  expect(todayPaint.background).not.toBe(selectedPaint.background);

  // A plain day: not today, not picked, not focused. The two guards below stop
  // the cheap wrong fixes — unpainting the selection, or unmarking today.
  const plain = reopened.days
    .and(page.locator(":not([data-today])"))
    .and(page.locator(":not([data-selected])"))
    .and(page.locator(":not([data-outside-month])"))
    .first();
  const plainPaint = await paintOf(plain);

  expect(selectedPaint.background).not.toBe(plainPaint.background);
  expect(Object.values(todayPaint).join(" | ")).not.toBe(Object.values(plainPaint).join(" | "));
});
