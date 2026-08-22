/**
 * The period navigator, driven in a document.
 *
 * One control replaces every range picker on the dashboard: four grain tabs,
 * then `‹ 📅 title ›`. Four of its claims cannot be made by a unit test, because
 * none of them is a value — they are what a running document does when a tab, an
 * arrow or a day cell is clicked:
 *
 *  1. a tab switches the grain the reader is standing in;
 *  2. `‹` moves back exactly ONE period — the new window ends where the old one
 *     began, so consecutive presses tile the calendar with no gap and no overlap;
 *  3. THE FORWARD ARROW IS THE LIVE INDICATOR. It is dead on the period holding
 *     now and alive one step back. That disabled state is the whole design: there
 *     is no "Live" tab, and if the arrow were merely broken-looking the reader
 *     would have no way to know they are on the live period;
 *  4. reopening the calendar after applying a custom range shows NO stale
 *     selection. This was a live bug in the control this replaced (deleted
 *     `preset-range-picker.svelte` kept its `DateRange` state across a close, so
 *     the second click on the same day landed on a COMPLETE range, bits-ui
 *     restarted it, and the user's selection silently disappeared). It is a named
 *     requirement of the replacement, not a nice-to-have —
 *     `e2e/range-picker-selection.spec.ts` had to change its gesture because of
 *     it, and says so.
 *
 * /history and /statistics both mount this control for real, so it could be
 * driven through a route. The spec mounts it itself, through
 * `support/period-navigator-harness.svelte`, because the harness prints the
 * `[from, to)` the page would fetch straight off the model and lets a case pin
 * the locale — neither of which a page carrying a hundred chart cards can offer. Everything the spec asserts
 * on is either an accessible name the component renders or a readout the harness
 * prints from the state the component wrote — never a class and never a test-only
 * attribute on the component.
 */

import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { openPage } from "./support/open-page";

/** Vite serves the harness from disk; `server.fs.allow` in vite.config.ts names `e2e`. */
const HARNESS = fileURLToPath(
  new URL("./support/period-navigator-harness.svelte", import.meta.url),
);

/** The `‹ 📅 title ›` row's own group, inside the mounted harness. */
function arrowRow(page: Page): Locator {
  return page.locator("#harness").getByRole("group", { name: "Select range" });
}

/**
 * A page holding one navigator and nothing else.
 *
 * /#/login is the host because it is the cheapest route in the app that boots
 * without the live socket; the harness hides it and mounts the control beside it.
 */
async function openNavigator(page: Page, locale?: string) {
  await openPage(page, "/#/login", { live: false });
  await page.evaluate(
    async ({ path, locale }) => {
      const module = (await import(/* @vite-ignore */ `/@fs${path}`)) as {
        mountHarness: (locale?: string) => void;
      };
      module.mountHarness(locale);
    },
    { path: HARNESS, locale },
  );

  const navigator = {
    tab: (name: string) => page.getByRole("button", { name, exact: true }),
    // The arrows are named for the GRAIN they step ("Previous month"), so they
    // are addressed by position inside their own group rather than by a name
    // that changes with the tab a case has just clicked. First and last of the
    // three controls in the row.
    back: arrowRow(page).getByRole("button").first(),
    forward: arrowRow(page).getByRole("button").last(),
    /** The calendar button: its text is the title the navigator prints. */
    trigger: page.locator("#harness [data-popover-trigger]"),
    grain: page.getByTestId("grain"),
    override: page.getByTestId("override"),
    from: page.getByTestId("from"),
    to: page.getByTestId("to"),
    /** The grain row, and the four tabs in it — positionally, so a case about
     *  geometry does not have to know a locale's words. */
    grainRow: page.locator("#harness [role=group]").first(),
    /** Every day cell in the open calendar, by ISO date on `data-value`. */
    days: page.locator("[data-bits-day]"),
    day: (isoDate: string) => page.locator(`[data-bits-day][data-value="${isoDate}"]`),
  };
  await expect(navigator.trigger).toBeVisible();
  return navigator;
}

/**
 * What a tab actually paints.
 *
 * The active tab has to be OBVIOUS, and "obvious" is a resolved colour rather
 * than a class name: a fix that spells the active treatment differently is still
 * a fix, and a class assertion would pass for a variant sitting on the wrong
 * element. Same reason `range-picker-selection.spec.ts` reads computed colour.
 */
async function paintOf(tab: Locator): Promise<string> {
  return tab.evaluate((el) => getComputedStyle(el).backgroundColor);
}

const TABS = ["Day", "Week", "Month", "Year"] as const;

/**
 * Which tabs are painted the same as `tab` — `["Week"]` alone once Week is the
 * only lit one, and all four when none is.
 *
 * Read as a SET rather than "the active tab is coloured", because the cheap
 * wrong answer is painting every tab alike: that satisfies "the active one has a
 * background" and tells the reader nothing. Polled, because the button carries a
 * colour transition and a single read lands mid-animation — the four tabs then
 * disagree about a state they are all on their way to.
 */
async function tabsPaintedLike(
  navigator: { tab: (name: string) => Locator },
  tab: string,
): Promise<string[]> {
  const target = await paintOf(navigator.tab(tab));
  const paints = await Promise.all(TABS.map((name) => paintOf(navigator.tab(name))));
  return TABS.filter((_, i) => paints[i] === target);
}

/** Open the calendar popover and wait for the grid to paint. */
async function openCalendar(navigator: { trigger: Locator; days: Locator }) {
  await navigator.trigger.click();
  await expect(navigator.days.first()).toBeVisible();
}

/** `2026-08-19` for a cell's ISO date, biased into the past when there is room. */
function neighbourOf(todayIso: string): string {
  const [year, month, day] = todayIso.split("-").map(Number);
  const target = day > 3 ? day - 2 : day + 2;
  return `${year}-${String(month).padStart(2, "0")}-${String(target).padStart(2, "0")}`;
}

test("the four tabs switch the grain the reader is standing in", async ({ page }) => {
  const navigator = await openNavigator(page);
  await expect(navigator.grain).toHaveText("day");
  const dayTitle = await navigator.trigger.textContent();

  for (const [tab, grain] of [
    ["Week", "week"],
    ["Month", "month"],
    ["Year", "year"],
    ["Day", "day"],
  ] as const) {
    await navigator.tab(tab).click();
    await expect(navigator.grain).toHaveText(grain);
    // …and the tab that answered is the one that looks answered, alone.
    await expect.poll(() => tabsPaintedLike(navigator, tab)).toEqual([tab]);
  }

  // Back on Day, and the title the navigator prints is the day's again — a tab
  // that changed the model while the header kept saying "2026" would be worse
  // than one that did nothing.
  await expect(navigator.trigger).toHaveText(dayTitle ?? "");
});

test("a tab keeps the reader live rather than teleporting them to a period's start", async ({
  page,
}) => {
  // Standing on the current period is the state the disabled forward arrow is
  // announcing, so Month → Day on the 19th means today, not the 1st.
  const navigator = await openNavigator(page);
  const today = await navigator.from.textContent();

  await navigator.tab("Month").click();
  await expect(navigator.forward).toBeDisabled();
  await navigator.tab("Day").click();

  await expect(navigator.from).toHaveText(today ?? "");
  await expect(navigator.forward).toBeDisabled();
});

test("the back arrow moves exactly one period, tiling the calendar", async ({ page }) => {
  const navigator = await openNavigator(page);

  for (const tab of ["Day", "Week", "Month", "Year"]) {
    await navigator.tab(tab).click();
    const start = await navigator.from.textContent();
    const title = await navigator.trigger.textContent();

    await navigator.back.click();

    // The window that ENDS where the previous one began: one period back, with
    // no gap and no overlap.
    await expect(navigator.to).toHaveText(start ?? "");
    expect(await navigator.trigger.textContent()).not.toBe(title);
    await expect(navigator.grain).toHaveText(tab.toLowerCase());

    // TWICE, because one press cannot tell a step apart from a re-anchor: an
    // arrow that resolved `now - 1` instead of `period - 1` lands on the same
    // window however many times it is pressed, and the single-press assertion
    // above is green for it.
    const second = await navigator.from.textContent();
    await navigator.back.click();
    await expect(navigator.to).toHaveText(second ?? "");
    expect(second).not.toBe(await navigator.from.textContent());
  }
});

test("the forward arrow is the live indicator: dead on the current period, alive one step back", async ({
  page,
}) => {
  const navigator = await openNavigator(page);

  // On the period holding now — at its first instant and at its last.
  await expect(navigator.forward).toBeDisabled();
  await expect(navigator.trigger).toContainText("Live");

  await navigator.back.click();
  await expect(navigator.forward).toBeEnabled();
  await expect(navigator.trigger).not.toContainText("Live");

  // …and forward returns to live, where it goes dead again. Nothing past live:
  // a second press must not walk into the future.
  await navigator.forward.click();
  await expect(navigator.forward).toBeDisabled();
  await expect(navigator.trigger).toContainText("Live");
});

test("reopening the calendar after a custom range shows no stale selection", async ({ page }) => {
  const navigator = await openNavigator(page);

  await openCalendar(navigator);
  // bits-ui writes the ISO date on every day cell; the visible number is not
  // unique — a neighbouring month bleeds into the grid.
  const today = navigator.days.and(page.locator("[data-today]"));
  const todayIso = await today.getAttribute("data-value");
  expect(todayIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const first = neighbourOf(todayIso ?? "");

  // The reported gesture: the same day twice is a one-day range, which applies
  // and closes the popover.
  await navigator.day(first).click();
  await navigator.day(first).click();
  await expect(navigator.override).toHaveText("custom");
  await expect(navigator.days.first()).toBeHidden();

  // THE BUG. The control being replaced reopens with the applied range still
  // painted, and the next click lands on a COMPLETE range: bits-ui restarts it,
  // the `$effect` sees an incomplete range, and the selection the user could
  // see a moment ago is gone with nothing applied.
  await openCalendar(navigator);
  await expect(navigator.days.and(page.locator("[data-selected]"))).toHaveCount(0);

  // And the fresh pick right after it still works — a calendar cleared by
  // disabling it would satisfy the count above.
  const second = neighbourOf(first);
  await navigator.day(second).click();
  await navigator.day(second).click();
  await expect(navigator.override).toHaveText("custom");
  await expect(navigator.from).toContainText(second);
});

test("the kept presets live behind the calendar button and light no tab", async ({ page }) => {
  const navigator = await openNavigator(page);

  await openCalendar(navigator);
  // 1h / 6h / 14d / 6mo are not calendar periods and have no tab; they are kept
  // rather than deleted, beside the arbitrary-range calendar.
  for (const label of ["1 hour", "6 hours", "Last 14 days", "Last 6 months"]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  }

  const litOnToday = await paintOf(navigator.tab("Day"));
  await page.getByRole("button", { name: "6 hours", exact: true }).click();
  await expect(navigator.override).toHaveText("6h");
  await expect(navigator.trigger).toHaveText(/6 hours/);

  // No grain tab may claim a six-hour window: lighting the grain of the period
  // the reader last stood on would say a rolling six hours is a day. All four
  // alike…
  await expect.poll(() => tabsPaintedLike(navigator, "Day")).toEqual([...TABS]);
  // …and alike in the UNLIT treatment, not lit as a group.
  expect(await paintOf(navigator.tab("Day"))).not.toBe(litOnToday);
});

test("all four tabs share one row of equal columns at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Italian, because "Settimana" is the widest tab label in the five catalogues
  // and a row that survives English proves very little.
  const navigator = await openNavigator(page, "it");

  const tabs = navigator.grainRow.getByRole("button");
  await expect(tabs).toHaveCount(4);

  const boxes = await Promise.all(
    (await tabs.all()).map(async (tab) => {
      const box = await tab.boundingBox();
      expect(box).not.toBeNull();
      return box!;
    }),
  );

  // One row: a wrapped fourth tab reads as a separate control, which is the
  // reason `SEGMENTED_MAX_OPTIONS` is 3 and this row is a grid instead.
  expect(new Set(boxes.map((b) => Math.round(b.y))).size).toBe(1);

  // Equal columns spanning the control, not four content-sized chips huddled at
  // one end: the tabs are the width the reader aims a thumb at, and "Anno" must
  // not be a third of the target "Settimana" is.
  const widths = boxes.map((b) => Math.round(b.width));
  expect(new Set(widths).size).toBe(1);
  const row = await navigator.grainRow.boundingBox();
  expect(widths.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(Math.round(row!.width) - 4);

  const overflow = await page.evaluate(() => {
    const host = document.querySelector("#harness");
    return host === null ? -1 : host.scrollWidth - document.documentElement.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
});

test("on a laptop the whole navigator is one row, aligned with the toolbar beside it", async ({
  page,
}) => {
  // The complaint: on a desktop /statistics toolbar the navigator was a
  // two-row block (tabs over stepper) sitting next to a one-row compare
  // switcher and a one-row gear, so three controls on one line had three
  // different heights and nothing shared a baseline. The stack is a PHONE
  // answer — at 390px four tabs and a stepper cannot share 358px — and a
  // laptop has the width to spend.
  //
  // German on purpose: "Vorheriger Zeitraum" is what makes the row wide in the
  // reported screenshot, and a layout that only holds in English proves little.
  await page.setViewportSize({ width: 1440, height: 900 });
  const navigator = await openNavigator(page, "de");

  const tabs = navigator.grainRow.getByRole("button");
  const stepper = page.getByRole("group", { name: /zeitraum|range/i }).last();

  const rows = await Promise.all(
    [...(await tabs.all()), stepper].map(async (el) => {
      const box = await el.boundingBox();
      expect(box).not.toBeNull();
      return Math.round(box!.y);
    }),
  );

  // Every tab AND the stepper start on the same line. Reverting the sm: row
  // direction puts the stepper ~32px below the tabs and this fails.
  expect(new Set(rows).size).toBe(1);
});
