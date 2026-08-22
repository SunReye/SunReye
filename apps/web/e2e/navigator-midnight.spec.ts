/**
 * The clock the navigator reads is a LIVE clock.
 *
 * A dashboard is left open. The `now` the navigator judges everything against
 * was a `$props()` default (`now = new Date()`), which Svelte 5 evaluates once
 * and caches, and both pages resolved their opening period from `new Date()` at
 * init. Nothing re-read the clock, so at 03:00 the control still said
 *
 *     ‹  📅 Today ● Live  › (disabled)
 *
 * while standing on YESTERDAY. Every part of that is a lie, and the disabled
 * forward arrow is the worst of them: it is this design's ONLY live indicator —
 * there is no "Live" tab — so a dead arrow means "there is nothing past here".
 * The reader was told they were live, was on the previous day, and had no
 * control left that could take them to today.
 *
 * Only a document can show this: it is not a value, it is a value that has to
 * change without anyone touching the page. `page.clock` is the laptop lid — the
 * page loads at 23:30 and is looked at again three hours later.
 *
 * WHAT THE FIX IS NOT: the period does not roll forward on its own. `range` is
 * what ~60 metric cards fetch and draw; re-deriving it on a clock tick is the
 * shape of the PR #60 outage (~12 socket re-leases a second). The reader stays
 * on the window they were looking at — which the title now NAMES rather than
 * calling "Today" — and the arrow that leads to the new day is alive. One
 * press, and the clock the navigator reads agrees with the world again.
 */

import { expect, test } from "@playwright/test";
import { openHistory, periodNavigator } from "./support/history";

/** Half an hour before midnight, in the browser's own zone. */
const BEFORE_MIDNIGHT = new Date(2026, 7, 20, 23, 30);

test("crossing midnight moves the title off Today and revives the forward arrow", async ({
  page,
}) => {
  // Installed BEFORE the navigation, so the page boots believing it is 23:30 and
  // time keeps flowing from there.
  await page.clock.install({ time: BEFORE_MIDNIGHT });
  const backend = await openHistory(page);
  const nav = periodNavigator(page);

  // The opening state: the current day, which IS the live view.
  await expect(nav.trigger).toContainText("Live");
  await expect(nav.forward).toBeDisabled();
  const opened = (await nav.trigger.textContent()) ?? "";

  // The lid closes and opens again at 02:30 the next day. The live socket's own
  // frames are the tick the navigator re-reads its clock on, so nothing here
  // touches the page.
  await page.clock.fastForward("03:00:00");

  // The period the reader is standing on is Aug 20, and now it says so.
  await expect(nav.trigger).toHaveText(/Aug 20/);
  await expect(nav.trigger).not.toContainText("Live");
  expect(await nav.trigger.textContent()).not.toBe(opened);

  // THE ARROW. Alive, because there is now something past this period — and one
  // press lands on the new day, where it goes dead again for the right reason.
  await expect(nav.forward).toBeEnabled();
  await nav.forward.click();
  await expect(nav.trigger).toContainText("Live");
  await expect(nav.trigger).not.toHaveText(/Aug 20/);
  await expect(nav.forward).toBeDisabled();

  // …and the day that rolled over cost the page no storm and no reconnect.
  expect(backend.socketOpens).toBe(1);
  expect(backend.unhandled).toEqual([]);
});
