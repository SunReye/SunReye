/**
 * Three regressions the page-shell / section-card migration introduced, and the
 * shape of each fix.
 *
 * Source-text assertions in the established style (`lib/layout/primitives.test.ts`):
 * runes do not run under `bun test` and there is no render harness, so the
 * behaviour is proven by reading the components. Every case here is written to
 * fail on the exact regression it names — "the class appears somewhere in the
 * file" would pass all three of the bugs below.
 */

import { describe, expect, test } from "bun:test";
import { SECTION_PAD, SHELL_PAD } from "../../layout/tokens";

const LAYOUT = new URL("./", import.meta.url);
const ROUTES = new URL("../../../routes/(app)/", import.meta.url);

async function read(url: URL): Promise<string> {
  return await Bun.file(url).text();
}

const sectionHeader = await read(new URL("section-header.svelte", LAYOUT));
const pageShell = await read(new URL("page-shell.svelte", LAYOUT));
const peakShaving = await read(new URL("automations/peak-shaving/+page.svelte", ROUTES));
const history = await read(new URL("history/+page.svelte", ROUTES));
const controls = await read(new URL("controls/+page.svelte", ROUTES));

/** The `class="…"` of the section card's visible heading. */
function headingClasses(): string {
  const h2 = sectionHeader.match(/<h2\b[\s\S]*?>/);
  expect(h2, "section-header no longer writes an <h2>").not.toBeNull();
  const classes = h2![0].match(/class="([^"]*)"/);
  expect(classes, "the heading carries no class attribute").not.toBeNull();
  return classes![1]!;
}

describe("a section title that does not fit wraps instead of losing its end", () => {
  // Why this is arithmetic and not a screenshot: the app is font-mono end to
  // end (`--font-mono: "Geist Mono Variable"`, app.css), and every Geist Mono
  // glyph advances 0.6em on a 1000-unit em. At `text-sm` (14px) with
  // `tracking-wide` (0.025em) one character is exactly 14 * (0.6 + 0.025) =
  // 8.75px, so a title's rendered width is a number this test can compute.
  const CHAR_PX = 14 * (0.6 + 0.025);

  /** Tailwind's spacing step (`--spacing: 0.25rem`) at a 16px root. */
  const SPACING_PX = 4;

  /** The base (pre-`sm:`) `p-<n>` a token spends, doubled for both gutters. */
  function gutterPx(token: string): number {
    const step = token.match(/^p-([\d.]+)/);
    expect(step, `${token} no longer opens with a base p- step`).not.toBeNull();
    return Number(step![1]) * SPACING_PX * 2;
  }

  /** Horizontal room a section header has for its title at a given viewport:
   *  the shell's gutter and the section card's gutter both come out of it. */
  const titleRoomPx = (viewport: number) => viewport - gutterPx(SHELL_PAD) - gutterPx(SECTION_PAD);

  // The regression was real, not hypothetical, and it is worth pinning that the
  // arithmetic still says so: if a future gutter or type-scale change made the
  // longest German title fit at 320px, the reset below would be dead weight and
  // this test says so out loud rather than leaving it uncommented forever.
  test("the longest German section title overflows a 320px phone", async () => {
    const de = await Bun.file(new URL("../../../../messages/de.json", import.meta.url)).json();
    const title: string = de.peak_shaving_title;
    expect(title).toBe("PV-Spitzenkappung & Prognoseladen");
    expect(title.length * CHAR_PX).toBeGreaterThan(titleRoomPx(320));
    // …and fits on the 412px phone the density work is measured against, which
    // is why this is a small-screen reset and not a blanket removal.
    expect(title.length * CHAR_PX).toBeLessThan(titleRoomPx(412));
  });

  // `truncate` stays for the desktop case it was written for. What it may not
  // do is fire on a phone, where the row is `flex-wrap` and a second line costs
  // nothing while a silent ellipsis costs the end of the title.
  test("the heading takes its nowrap back below the sm breakpoint", () => {
    const classes = headingClasses();
    expect(classes.split(/\s+/)).toContain("max-sm:whitespace-normal");
  });

  // The reset only wins because the header row wraps: without `flex-wrap` a
  // two-line title would shove the action cluster off the right edge, which is
  // the failure `truncate` was originally guarding against.
  test("the header row still wraps, so a two-line title costs no actions", () => {
    const row = sectionHeader.match(/<div class="flex[^"]*"[^>]*>/);
    expect(row).not.toBeNull();
    expect(row![0]).toContain("flex-wrap");
  });
});

describe("the toolbar row has a left end", () => {
  /** The single row PageShell draws above `children`, opening tag to close. */
  function toolbarRow(): string {
    const row = pageShell.match(/\{#if hasToolbarRow\}[\s\S]*?\{\/if\}/);
    expect(row, "PageShell no longer guards one row for lead + toolbar").not.toBeNull();
    return row![0];
  }

  // The bug: `lead` content had nowhere to go but `children`, which PageShell
  // renders AFTER the toolbar row — so a back link landed under the live
  // indicator, one row lower than the thing it used to sit beside.
  test("lead renders inside the toolbar row, ahead of the controls", () => {
    const row = toolbarRow();
    const leadAt = row.indexOf("{@render lead?.()}");
    const toolbarAt = row.indexOf("{@render toolbar?.()}");
    expect(leadAt).toBeGreaterThanOrEqual(0);
    expect(toolbarAt).toBeGreaterThanOrEqual(0);
    expect(leadAt).toBeLessThan(toolbarAt);
  });

  // `justify-between` would look right only while a lead exists; the six pages
  // with a toolbar and no lead would quietly move their controls to the left
  // edge. `ml-auto` on the control cluster holds the right edge either way.
  test("the controls stay hard right whether or not a lead is present", () => {
    const row = toolbarRow();
    expect(row).toMatch(/<div class="ml-auto flex[^"]*">[\s\S]*?\{@render toolbar\?\.\(\)\}/);
    // The outer row's own classes, comments excluded — the prose below explains
    // why `justify-between` is wrong here and would otherwise match.
    const outer = row.match(/<div class="([^"]*)"/);
    expect(outer).not.toBeNull();
    expect(outer![1]).not.toContain("justify-between");
  });

  // Six of the seven pages pass a toolbar and no lead, and the overview passes
  // neither. An unguarded row would cost that page an empty flex child plus the
  // shell's `gap-6` above its first block — a whole section's worth of space to
  // render nothing.
  test("the row is guarded on both of its ends, not just one", () => {
    const guard = pageShell.match(/const hasToolbarRow = [^\n]*/);
    expect(guard, "the row guard is no longer a named derived").not.toBeNull();
    expect(guard![0]).toContain("lead");
    expect(guard![0]).toContain("toolbar");
  });

  // The new snippet is a snippet, not an escape hatch: PageShell still refuses
  // a `class` and still has no rest element to smuggle one in through.
  test("adding lead did not open PageShell up to arbitrary classes", () => {
    const props = pageShell.match(/let \{[\s\S]*?\}:/);
    expect(props).not.toBeNull();
    expect(props![0]).not.toContain("...");
    expect(pageShell).not.toMatch(/\bclass\?:/);
  });

  test("peak-shaving puts its back link in lead, not in the page body", () => {
    const lead = peakShaving.match(/\{#snippet lead\(\)\}[\s\S]*?\{\/snippet\}/);
    expect(lead, "the page declares no lead snippet").not.toBeNull();
    expect(lead![0]).toContain("resolve('/automations')");

    // Nothing outside the snippets may still draw a link: the whole point is
    // that the back link stopped being a row of its own under the toolbar.
    const body = peakShaving.replace(/\{#snippet[\s\S]*?\{\/snippet\}/g, "");
    expect(body).not.toMatch(/<a[\s>]/);
  });
});

describe("the last two copies of the empty-state block", () => {
  /** The verbatim block that was pasted into six files; `h-40` is the tell —
   *  EmptyState deliberately spends `min-h-32` so it does not reserve a fifth
   *  of a phone screen to say nothing. */
  const COPIED =
    "flex h-40 items-center justify-center border border-border text-sm text-muted-foreground";

  const pages: [string, string][] = [
    ["history/+page.svelte", history],
    ["controls/+page.svelte", controls],
  ];

  test.each(pages)("%s renders EmptyState instead of the copy", (_name, code) => {
    expect(code).toContain("$lib/components/layout/empty-state.svelte");
    expect(code).toMatch(/<EmptyState[\s/>]/);
    expect(code).not.toContain(COPIED);
    expect(code).not.toContain("h-40");
  });
});
