/**
 * Where a card's full-screen control sits, and how many of them there are.
 *
 * The complaint: on a phone the ⤢ was one icon in the header cluster, a single
 * 44px box away from the collapse caret, and the two were pressed for each other.
 * It is in the plot's bottom-right corner now, diagonally opposite the zoom reset
 * in the top-right — the largest separation two corners of one card allow.
 *
 * A browser claim, and it has to be. The control is drawn by
 * `layout/plot-frame.svelte` from a `FullscreenBox` published through Svelte
 * context by whichever `Section` encloses it, and consumed several components
 * down inside whatever chart the card happens to render. Nothing in the source
 * says where that lands on screen: the corner resolves against the nearest
 * positioned ancestor, and which element that is depends on a chain of wrappers
 * each chart owns. `charts/fullscreen-coverage.test.ts` proves the control EXISTS
 * for every card that offers it; only a laid-out document says where.
 *
 * Both claims below fail on the layout this replaced — the header ⤢ is in the
 * header row, nowhere near a plot's lower edge, and the energy-split card drew
 * one per plot before `claimCorner` existed.
 */

import { expect, test, type Page } from "@playwright/test";
import { openPage } from "./support/open-page";

const PHONE = { width: 390, height: 844 };

/** WCAG 2.5.5's target size, which is also the size of every icon control here
 *  (`TAP`) — so "at least this far apart" means "cannot be a mispress". */
const SAFE_SEPARATION_PX = 44;

interface CardControls {
  title: string;
  /** How many full-screen controls this card draws. */
  triggers: number;
  /** Gap from the trigger's box to the plot's bottom edge, in CSS pixels. */
  toPlotBottom: number | null;
  /** Gap from the trigger's box to the plot's right edge. */
  toPlotRight: number | null;
  /** Distance from the trigger to the card's collapse caret, if it has one. */
  toCaret: number | null;
  /** Is the trigger inside the header row rather than over the plot? */
  inHeader: boolean;
}

/**
 * Every card that draws a full-screen control, measured.
 *
 * Cards are found from their PLOTS and then walked up to the enclosing section,
 * so a card with no chart is not counted; a statistics panel is a section nested
 * in a section, and `closest` from the plot lands on the inner one, which is the
 * box that expands.
 */
async function cardControls(page: Page): Promise<CardControls[]> {
  return page.evaluate(() => {
    const out: CardControls[] = [];
    const seen = new Set<Element>();
    for (const plot of document.querySelectorAll("[data-slot=chart]")) {
      const card = plot.closest("section");
      if (!card || seen.has(card)) continue;
      seen.add(card);

      // By accessible name, the way a reader finds it — not by a data-slot,
      // which would pass even if the button were labelled as something else.
      const triggers = [...card.querySelectorAll("button")].filter((b) =>
        /full screen/i.test(b.textContent ?? ""),
      );
      // The caret is NOT inside the card on /history — a card belongs to a
      // collapsible metric GROUP, and the caret is on the group's header. That
      // is the pair that was mispressed, so it is searched for on the page and
      // the nearest one is measured against.
      const carets = [...document.querySelectorAll("button")].filter((b) =>
        /^(show|hide) /i.test(b.getAttribute("aria-label") ?? ""),
      );
      const header = card.querySelector("[data-slot=section-actions]")?.parentElement ?? null;

      const first = triggers[0];
      const t = first?.getBoundingClientRect();
      // The plot the trigger actually sits over, which on a two-plot card is the
      // first one — not necessarily the plot this loop started from.
      const own = first?.closest("section")?.querySelector("[data-slot=chart]");
      const p = own?.getBoundingClientRect();

      const gap = (a: DOMRect, b: DOMRect) =>
        Math.hypot(
          Math.max(0, Math.max(a.left - b.right, b.left - a.right)),
          Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom)),
        );

      const caretGaps = t ? carets.map((c) => gap(t, c.getBoundingClientRect())) : [];

      out.push({
        title: (card.querySelector("h2")?.textContent ?? "").trim(),
        triggers: triggers.length,
        toPlotBottom: t && p ? Math.abs(p.bottom - t.bottom) : null,
        toPlotRight: t && p ? Math.abs(p.right - t.right) : null,
        toCaret: caretGaps.length ? Math.min(...caretGaps) : null,
        inHeader: !!(t && first && header?.contains(first)),
      });
    }
    return out;
  });
}

for (const route of ["/#/history", "/#/statistics"]) {
  test(`${route}: one full-screen control per card, in the plot's corner`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    const opened = await openPage(page, route);
    await expect(page.locator("[data-slot=chart]").first()).toBeVisible();

    const cards = (await cardControls(page)).filter((c) => c.triggers > 0);
    expect(cards.length, "no card on this route draws a full-screen control").toBeGreaterThan(0);

    for (const card of cards) {
      const where = `${route}, card: ${card.title || "(untitled)"}`;

      // ONE. The energy-split card holds two plots and two plot frames, and
      // before `claimCorner` both drew a ⤢ — two identical controls whose effect
      // was neither one's own plot.
      expect(card.triggers, `exactly one control — ${where}`).toBe(1);

      // In the plot's own bottom-right corner, not the header.
      //
      // The tolerance is 20px and it is a sum of two known insets, not a budget:
      // the chip sits 4px inside the plot FRAME, and the frame's box and the
      // chart container's box differ by up to the container's own bottom gutter
      // (measured at 9px on /statistics, where the x-axis labels live). 20px
      // leaves headroom for both plus sub-pixel rounding while staying far below
      // the failure it guards — a control in the header row is a whole row and a
      // readout row away, 60px or more, and one centred over the plot is half the
      // plot's width off.
      expect(card.inHeader, `not in the header row — ${where}`).toBe(false);
      expect(card.toPlotBottom, `at the plot's bottom edge — ${where}`).toBeLessThan(20);
      expect(card.toPlotRight, `at the plot's right edge — ${where}`).toBeLessThan(20);
    }

    // A control that lines up perfectly in a document that threw is not a
    // passing control.
    expect(opened.consoleErrors).toEqual([]);
  });
}

test("the control is a full target away from the caret it was mispressed for", async ({ page }) => {
  await page.setViewportSize(PHONE);
  // /history is where the complaint came from: ~100 cards, every one collapsible
  // through its group, every one with a ⤢.
  const opened = await openPage(page, "/#/history");
  await expect(page.locator("[data-slot=chart]").first()).toBeVisible();

  const withCaret = (await cardControls(page)).filter((c) => c.triggers > 0 && c.toCaret !== null);
  expect(withCaret.length, "no card has both controls to compare").toBeGreaterThan(0);
  for (const card of withCaret) {
    expect(card.toCaret, `⤢ to caret — ${card.title}`).toBeGreaterThanOrEqual(SAFE_SEPARATION_PX);
  }

  expect(opened.consoleErrors).toEqual([]);
});
