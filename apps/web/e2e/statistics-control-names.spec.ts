/**
 * Two controls on /statistics must not announce themselves identically.
 *
 * /statistics has carried a compare-mode button reading "Previous period" since
 * long before the period navigator existed — it lived in the Records section
 * then and sits in the page toolbar now, one row from these arrows. The
 * navigator arrived
 * with arrows labelled `range_prev_period` / `range_next_period` — and the back
 * arrow's aria-label was, word for word, that button's visible text. Two
 * controls, one page, one name, and they do completely different things: one
 * steps the window a period back, the other re-bases every delta chip.
 *
 * That is a screen-reader defect first ("Previous period, button" twice, with
 * nothing to tell them apart) and a test defect second: `support/history.ts`'s
 * `periodNavigator` addresses the arrows by name, so on this route the locator
 * was ambiguous and any spec using it would have failed in strict mode for a
 * reason that had nothing to do with what it was measuring.
 *
 * The claim is deliberately made over the WHOLE page rather than over the two
 * controls that happened to collide: a name is unambiguous or it is not, and the
 * next control to land on this route does not get a pass. Accessible names come
 * from `ariaSnapshot`, so the assertion spends Playwright's own name
 * computation rather than a hand-rolled `aria-label ?? textContent`.
 */

import { expect, type Locator, type Page, test } from "@playwright/test";
import { openPage } from "./support/open-page";

/**
 * Every control name in `scope`, as the accessibility tree reports them.
 *
 * Per matched element, because `ariaSnapshot` is strict and the navigator is two
 * sibling groups rather than one box.
 *
 * Both roles, because the segmented switchers are real ToggleGroups now: the
 * grain tabs report as `radio` inside a radiogroup while the arrows and the
 * calendar trigger are still `button`. Matching only one role would quietly
 * shrink the census this test's whole claim is made over — and a name collision
 * between a radio and a button is exactly as bad for a screen reader as one
 * between two buttons.
 */
async function controlNames(scope: Locator): Promise<string[]> {
  const names: string[] = [];
  for (const row of await scope.all()) {
    const snapshot = await row.ariaSnapshot();
    names.push(...[...snapshot.matchAll(/- (?:button|radio) "([^"]*)"/g)].map((match) => match[1]));
  }
  return names;
}

/** The one control answering to `name`, whichever of the two roles it carries. */
function named(page: Page, name: string): Locator {
  return page
    .getByRole("button", { name, exact: true })
    .or(page.getByRole("radio", { name, exact: true }));
}

/** The navigator's two rows: the four grain tabs, and `‹ 📅 title ›`. */
function navigatorRows(page: Page): Locator {
  return page.getByRole("group", { name: /^Select (time span|range)$/ });
}

test("no navigator control shares its accessible name with anything else on /statistics", async ({
  page,
}) => {
  const opened = await openPage(page, "/#/statistics");

  // The compare switcher is the control that collides, and it only exists once
  // the comparison payload has landed — so wait for its OTHER option before
  // counting anything.
  await expect(page.getByRole("radio", { name: "Year ago", exact: true })).toBeVisible();
  await expect(navigatorRows(page)).toHaveCount(2);

  const names = await controlNames(navigatorRows(page));
  // Four tabs, two arrows, the calendar trigger.
  expect(names).toHaveLength(7);

  // Unique WITHIN the navigator…
  expect([...new Set(names)]).toHaveLength(names.length);
  // …and unique on the page: exactly one control answers to each of them.
  for (const name of names) {
    await expect(named(page, name)).toHaveCount(1);
  }

  // And the collision was resolved by naming the ARROWS, not by renaming the
  // compare mode out from under the reader who already knows it.
  await expect(named(page, "Previous period")).toHaveCount(1);
  expect(names).not.toContain("Previous period");

  expect(opened.consoleErrors).toEqual([]);
});
