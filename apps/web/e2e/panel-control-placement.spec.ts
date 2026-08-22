/**
 * Two vertical lines, on every chart card, at every width.
 *
 * ## The claim
 *
 * A chart card's controls used to scatter. The header was one `flex-wrap` row
 * and its right-hand cluster carried `max-sm:[&:has(>*)]:w-full` +
 * `justify-center`, so the SAME cluster was right-aligned beside a short title
 * ("Energy split") and CENTRED on a row of its own under a long or captioned one
 * ("Hour of the week", "2026 versus last year"). Three cards on one page, three
 * placements, none of them chosen — and which one you got depended on the length
 * of a translated string.
 *
 * The four-zone grammar replaced it, and the whole of it reduces to two edges a
 * reader's eye can follow down the card:
 *
 *  - **Z2**, the header's chrome cluster, ends where the card's content ends.
 *  - **Z3**, the readout row's value, starts where the card's content starts.
 *
 * Both at 360, 768 and 1440, on /history and /statistics, so there is no phone
 * arrangement and no desktop arrangement — there is one arrangement. Z3 is the
 * only zone allowed to wrap, and when it wraps it STACKS LEFT: its controls
 * leave the right edge and join the left one, which is the case that separates
 * "stacked" from "centred".
 *
 * ## Why the browser
 *
 * Not one of these numbers can be read off a class string. The utilities were
 * already "correct" while this was broken — `justify-end` was on the cluster the
 * whole time — and where the box actually landed was decided by how much room a
 * `flex-wrap` sibling left it, i.e. by the title. Only a laid-out document knows
 * which line a box is on. `tokens.test.ts` owns the decision; this spec owns the
 * geometry.
 *
 * ## How each case was proved to discriminate
 *
 * A case that passes on the old layout is worthless, so the old layout was
 * rebuilt in the live document and every measurement re-taken: a scratch copy of
 * this file put the header grid back to `flex flex-wrap items-center` and gave
 * the cluster its `max-sm:w-full justify-center` / `sm:ml-auto` pair, and turned
 * the readout row back into the wrapping, centring flex line that arrangement
 * implies. Measured, in pixels off the content edge:
 *
 *  - Z3 `valueLeftGap` 32-110px at 360, 207-285 at 768, 463-541 at 1440;
 *    `controlsLeftGap` 67-176 at 360. Red everywhere, by two orders of
 *    magnitude over the tolerance.
 *  - Z2 `clusterSameRowAsTitle` false for all 8 cards at 360 (true at 768 and
 *    1440, which is why the case is width-swept and not phone-only).
 *  - Z2 `clusterRightGap` stayed 0.0 under that reconstruction, and the case is
 *    kept anyway with its eyes open: a CENTRED cluster that is also `w-full`
 *    ends at the right edge too, so this number alone never saw the phone bug —
 *    `clusterSameRowAsTitle` is what catches it. What `clusterRightGap` does
 *    guard is the next regression rather than the last one: any padding, margin
 *    or width put back on the cluster, or a `sm:` variant that moves it.
 *
 * The Z3 cases are additionally structural: before this change no
 * `[data-slot=panel-readout-row]` existed at all — the value lived in the header
 * on /history and loose in the body on /statistics — so `expect(withRow.length)`
 * alone fails on a revert.
 */

import { expect, test, type Page } from "@playwright/test";
import { openPage } from "./support/open-page";

/**
 * The three widths, and why these three. 360 is the narrow phone (below the
 * 390px the density specs use, because the stacking rule is what breaks first
 * and it breaks at the narrow end); 768 is the tablet just above the `sm`
 * breakpoint, where the stack becomes two columns; 1440 is the laptop, where a
 * `sm:`-only fix would still look right and must not be enough to pass.
 */
const WIDTHS = [360, 768, 1440] as const;

/** Below `sm` (640px) the readout row stacks. Above it, two columns. */
const SM = 640;

/**
 * How far an edge may sit from the card's content edge and still count as
 * aligned.
 *
 * 1px, and it is a rounding allowance rather than a budget. The suite renders at
 * `deviceScaleFactor: 2`, so a fractional grid track resolves to a device pixel
 * and a CSS-pixel box edge can carry a .5; a percentage-resolved padding adds
 * another fraction of the same size. Nothing in this layout can be off by a
 * whole pixel for a legitimate reason — the cluster and the value are grid cells
 * whose tracks are flush with the content box by construction. And every failure
 * this spec is for is enormous next to it: the old centred cluster missed the
 * right edge by ~100px at 360, and even a stray `px-2` would show as 8. So the
 * tolerance is small enough to catch every real defect and large enough that no
 * green run depends on how Chromium rounded.
 */
const ALIGN_TOLERANCE_PX = 1;

interface CardPlacement {
  title: string;
  /** Z2's right edge minus the card's content right edge. */
  clusterRightGap: number | null;
  /** The card's content left edge minus Z3's value left edge. */
  valueLeftGap: number | null;
  /** Z3's controls: distance to the right edge, and to the left one. */
  controlsRightGap: number | null;
  controlsLeftGap: number | null;
  /** Z2 is still on the title's own line (it never takes a row of its own). */
  clusterSameRowAsTitle: boolean | null;
}

/**
 * Every card holding a plot, with the four edges measured.
 *
 * Cards are discovered from the CHARTS, not from a list of titles: `[data-slot=chart]`
 * then `closest("section")`. A card containing a chart may itself contain
 * another card that contains it — every statistics panel is a section nested in
 * a section — and a `section:has(chart)` selector matches both, which would
 * measure a panel's cluster against its parent's content box. The innermost
 * section is the card the chart belongs to, and that is the one whose header and
 * readout row are its own.
 *
 * The card's content box is derived from its own computed padding rather than
 * from any inner element, because the inner elements are exactly what is under
 * test: measuring Z2 against the header row it sits in would let both drift
 * together and still pass.
 */
async function chartCardPlacements(page: Page): Promise<CardPlacement[]> {
  return page.evaluate(() => {
    const cards = new Set<HTMLElement>();
    for (const chart of document.querySelectorAll("[data-slot=chart]")) {
      const card = chart.closest("section");
      if (card instanceof HTMLElement) cards.add(card);
    }

    const gapTo = (a: number, b: number) => Math.abs(a - b);
    const out = [];
    for (const card of cards) {
      const style = getComputedStyle(card);
      const box = card.getBoundingClientRect();
      const contentLeft =
        box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
      const contentRight =
        box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);

      // `:scope >` all the way down: the card's OWN header grid and its OWN
      // readout row. A descendant match would pick up a nested panel's.
      const cluster = card.querySelector<HTMLElement>(":scope > div > [data-slot=section-actions]");
      const row = card.querySelector<HTMLElement>(
        ":scope > div > [data-slot=panel-readout-row], :scope > div > div > [data-slot=panel-readout-row]",
      );
      // Reached through the cluster's own parent — that parent IS the header
      // grid, so the two boxes compared below are guaranteed to be siblings in
      // one grid rather than a title from one card and a cluster from another.
      const title = cluster?.parentElement?.querySelector("h2");
      // A cell with no rendered child is a zero-width box: its edges are the
      // track's, not a control's, so aligning it proves nothing.
      const filled = (el: Element | null | undefined) =>
        el instanceof HTMLElement && el.children.length > 0 ? el : null;
      const value = filled(row?.querySelector(":scope > [data-slot=panel-readout-value]"));
      const controls = filled(row?.querySelector(":scope > [data-slot=panel-readout-controls]"));
      const clusterFilled = filled(cluster);

      out.push({
        title: (title?.textContent ?? "").trim(),
        clusterRightGap: clusterFilled
          ? gapTo(clusterFilled.getBoundingClientRect().right, contentRight)
          : null,
        valueLeftGap: value ? gapTo(value.getBoundingClientRect().left, contentLeft) : null,
        controlsRightGap: controls
          ? gapTo(controls.getBoundingClientRect().right, contentRight)
          : null,
        controlsLeftGap: controls
          ? gapTo(controls.getBoundingClientRect().left, contentLeft)
          : null,
        clusterSameRowAsTitle:
          clusterFilled && title
            ? Math.abs(
                clusterFilled.getBoundingClientRect().top - title.getBoundingClientRect().top,
              ) < title.getBoundingClientRect().height
            : null,
      });
    }
    return out;
  });
}

/** The two routes whose cards hold plots. */
const ROUTES = ["/#/history", "/#/statistics"] as const;

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    test(`${route} at ${width}px: every chart card's chrome ends at its right edge`, async ({
      page,
    }) => {
      // Viewport BEFORE the first layout: `openPage` takes none, and setting it
      // afterwards leaves the page having laid out at the 1024 default and
      // silently makes three cases one case.
      await page.setViewportSize({ width, height: 900 });
      const opened = await openPage(page, route);
      await expect(page.locator("[data-slot=chart]").first()).toBeVisible();

      const cards = await chartCardPlacements(page);
      console.log(
        `${route} @${width}: ${cards
          .map(
            (c) =>
              `${c.title || "(untitled)"} R${c.clusterRightGap?.toFixed(2) ?? "-"} L${c.valueLeftGap?.toFixed(2) ?? "-"}`,
          )
          .join(" | ")}`,
      );
      // A floor, so an empty page cannot pass the loop below by iterating
      // nothing. Charts mount lazily on /history, so this is "at least one card
      // is on screen", not a census — the census is `page-smoke`'s job.
      expect(cards.length).toBeGreaterThan(0);

      for (const card of cards) {
        const where = `${route} @${width}px, card: ${card.title}`;
        if (card.clusterRightGap !== null) {
          expect(card.clusterRightGap, `Z2 flush right — ${where}`).toBeLessThan(
            ALIGN_TOLERANCE_PX,
          );
          // Right-aligned is only half of it: the old layout ALSO reached the
          // right edge at desktop widths, one line lower.
          expect(card.clusterSameRowAsTitle, `Z2 on the title's row — ${where}`).toBe(true);
        }
      }

      // Every spec that opens a page also proves it opened clean — a card whose
      // chrome lines up in a document that threw is not a passing card.
      expect(opened.consoleErrors).toEqual([]);
    });

    test(`${route} at ${width}px: every readout starts at its card's left edge`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openPage(page, route);
      await expect(page.locator("[data-slot=chart]").first()).toBeVisible();

      const cards = await chartCardPlacements(page);
      const withRow = cards.filter((c) => c.valueLeftGap !== null || c.controlsRightGap !== null);
      // Z3 did not exist before this change — the value was in the header on
      // /history and loose in the body on /statistics — so this line alone is
      // red on a revert.
      expect(withRow.length, `no readout row on ${route} @${width}px`).toBeGreaterThan(0);

      for (const card of withRow) {
        const where = `${route} @${width}px, card: ${card.title}`;
        if (card.valueLeftGap !== null) {
          expect(card.valueLeftGap, `Z3 value flush left — ${where}`).toBeLessThan(
            ALIGN_TOLERANCE_PX,
          );
        }
        if (card.controlsRightGap !== null) {
          // The stacking rule, stated as the two mutually exclusive cases it
          // has. Below `sm` the row is one column and the controls join the
          // LEFT edge — the whole point of "wraps by stacking left-aligned,
          // never centred", and the one assertion a centred cluster cannot
          // satisfy from either side. Above it they hold the right edge.
          if (width < SM) {
            expect(card.controlsLeftGap, `Z3 controls stack left — ${where}`).toBeLessThan(
              ALIGN_TOLERANCE_PX,
            );
          } else {
            expect(card.controlsRightGap, `Z3 controls flush right — ${where}`).toBeLessThan(
              ALIGN_TOLERANCE_PX,
            );
          }
        }
      }
    });
  }
}
