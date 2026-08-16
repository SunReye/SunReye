/**
 * Phase 2.4: the bordered section card exists once.
 *
 * The card had six implementations with three different gaps, two of which
 * were not even the same idiom — /history drew a bottom-ruled sentence-case
 * header while /statistics, one nav entry above it, drew an uppercase muted
 * one for the same structural role. Five of the six animated their collapse
 * regardless of `prefers-reduced-motion`.
 *
 * There is no component-rendering harness (`apps/web/TESTING.md`), so these
 * cases read sources. Two of them are deliberately written as an EXACT set
 * rather than a per-file check: a new hand-rolled card, or a migrated file
 * that quietly grows its own heading back, shows up as an extra entry and
 * fails — a "contains Section somewhere" assertion would not notice either.
 */

import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

const SRC = new URL("../../", import.meta.url);
const SRC_DIR = Bun.fileURLToPath(SRC);

/** Every `.svelte` in the app, path relative to `src/`, sorted. */
const files: string[] = [...new Glob("**/*.svelte").scanSync(SRC_DIR)]
  .map((p) => p.replaceAll("\\", "/"))
  .sort();

const sources = new Map<string, string>(
  await Promise.all(files.map(async (f) => [f, await Bun.file(new URL(f, SRC)).text()] as const)),
);

function read(file: string): string {
  const code = sources.get(file);
  expect(code, `${file} is missing`).toBeDefined();
  return code!;
}

/** Files under the layout primitives — the one place the recipe may live. */
const isPrimitive = (file: string) => file.startsWith("lib/components/layout/");

/**
 * The opening `<Name …>` tag, attributes included and nothing past its own `>`.
 *
 * The naive `/<Section[\s\S]*?\bfoo\b[\s\S]*?>/` walks straight over the tag's
 * closing bracket, so it only says "the word appears somewhere after the first
 * `<Section`" — a prose comment in the body satisfies it. Attribute values are
 * consumed as units so neither a quoted `>` nor the `=>` in
 * `onOpenChange={(v) => …}` ends the tag early. Same discipline as `rootTag()`
 * in `routes/(app)/page-shells.test.ts`, kept local because a shared src helper
 * that only tests import is dead code to the production reachability gate.
 */
function openTagOf(code: string, name: string): string | null {
  const match = code.match(new RegExp(`<${name}(?:[^<>"'{]|"[^"]*"|'[^']*'|\\{[^{}]*\\})*>`));
  return match ? match[0] : null;
}

/** Whether `tag` carries `attribute`, shorthand (`nested`) or valued. */
function hasAttribute(tag: string, attribute: string): boolean {
  return new RegExp(`(?:^|\\s)${attribute}(?=[\\s/>=])`).test(tag);
}

/**
 * The section card's own heading, in any of the four idioms it drifted into.
 *
 * Any level, not just `<h2>`: five of the six variants were the same card at a
 * different heading level, and a census that only knows `<h2>` cannot see the
 * next hand-rolled one written with `<h3>` — which is the tag most of the
 * remaining bespoke cards already use. `sr-only` headings are landmark labels
 * for screen readers, not a card header.
 */
function writesOwnHeading(code: string): boolean {
  return [...code.matchAll(/<h[1-6][^>]*>/g)].some((tag) => !tag[0].includes("sr-only"));
}

/** An opening tag, attributes included, that does not run past its own `>`. */
const OPEN_TAG = /<[A-Za-z][\w.]*(?:[^<>]|\{[^{}]*\})*?>/g;
/** The frame `Section` draws: a full-strength border plus a pad. An opacity
 *  variant (`border-border/50`) is the tooltip and pill idiom, not the card. */
const FRAME = /(?:^|\s)border(?:\s|$)/;
const FRAME_COLOUR = /(?:^|\s)border-border(?:\s|$)/;
const PADDING = /(?:^|\s)p[xytrbles]?-[\d.]/;

/**
 * An element that draws the section card's frame itself.
 *
 * Keyed on the classes, not on `<section>`: a `<div class="flex flex-col gap-4
 * border border-border p-4">` with a heading inside it IS the card — the same
 * pixels, the same drift, and invisible to a `<section>`-only census. That
 * div is how a seventh variant arrives.
 */
function drawsOwnCard(code: string): boolean {
  for (const tag of code.matchAll(OPEN_TAG)) {
    for (const [, value] of tag[0].matchAll(/class="([^"]*)"/g)) {
      if (FRAME.test(value) && FRAME_COLOUR.test(value) && PADDING.test(value)) return true;
    }
  }
  return false;
}

/** The verbatim empty-state block that was copy-pasted into six files. */
const COPIED_EMPTY_STATE =
  "flex h-40 items-center justify-center border border-border text-sm text-muted-foreground";

const MIGRATED_SECTIONS = [
  "lib/components/inverter/custom-chart-section.svelte",
  "lib/components/inverter/subsystem-section.svelte",
  "routes/(app)/controls/controls-panel.svelte",
  "routes/(app)/history/metric-group.svelte",
  "routes/(app)/statistics/band-breakdown.svelte",
  "routes/(app)/statistics/chart-panel.svelte",
  "routes/(app)/statistics/statistics-section.svelte",
];

const MIGRATED_EMPTY_STATES = [
  "lib/components/settings/inverter-form.svelte",
  "lib/components/settings/mqtt-form.svelte",
  "lib/components/settings/tariff-form.svelte",
  "routes/(app)/statistics/statistics-body.svelte",
];

/**
 * Every heading outside the primitives today, each with the reason it is not a
 * section card. The set is exact, so a NEW heading anywhere — including the
 * `<h3>` a hand-rolled card would use — fails here until someone either
 * migrates it or writes down why it belongs.
 */
const HEADINGS_NOT_YET_MIGRATED = [
  // Page chrome: the `<h1>` title of a screen, not a card inside one. These
  // never become a Section — Section is a card in the content column.
  "components/AuthShell.svelte",
  "routes/(app)/+layout.svelte",
  "routes/setup/+page.svelte",
  // Bespoke card frames that carry their own heading — the phase-2.4 backlog.
  // Migrating one is a line deleted from here, and that is the point.
  "lib/components/inverter/custom-chart-card.svelte",
  "lib/components/inverter/energy-split-chart.svelte",
  "lib/components/inverter/entity-history-card.svelte",
  "lib/components/inverter/time-of-use.svelte",
  "lib/components/settings/danger-zone-form.svelte",
  "lib/components/setup/activate-step.svelte",
  "lib/components/setup/profile-step.svelte",
  "lib/components/statistics/hour-weekday-heatmap.svelte",
  // Sub-headings one level BELOW a card title, over a group inside it: a split
  // block inside the energy card, a slot inside the time-of-use editor, and
  // three statistics groups that share one section header. A Section here would
  // put a second card inside the first.
  "lib/components/inverter/energy-split-block.svelte",
  "lib/components/inverter/tou-slot-editor.svelte",
  "routes/(app)/statistics/price-whatif.svelte",
  "routes/(app)/statistics/records-section.svelte",
  "routes/(app)/statistics/yoy-panel.svelte",
].sort();

/**
 * Same discipline for the frame. The detector is idiom-free — any element with
 * `border border-border` and a pad — so the list holds two kinds of survivor:
 * cards awaiting migration, and small bordered chrome that was never a card.
 */
const CARDS_NOT_YET_MIGRATED = [
  // Bespoke section cards, the phase-2.4 backlog above seen from the frame side.
  "lib/components/inverter/custom-chart-card.svelte",
  "lib/components/inverter/energy-split-chart.svelte",
  "lib/components/inverter/entity-history-card.svelte",
  "lib/components/inverter/time-of-use.svelte",
  "lib/components/setup/activate-step.svelte",
  "lib/components/setup/profile-step.svelte",
  "lib/components/statistics/hour-weekday-heatmap.svelte",
  // Chrome, not cards. Each is a bordered thing SMALLER than a section: the
  // diagram's charger and battery badges, a price pill, a note paragraph, the
  // pinned-profile strip, the timezone preview readout, one tariff band row,
  // one time-of-use slot row, and the lock banner that already sits inside
  // controls-panel's Section. Framing them as Sections would be wrong, so they
  // are listed rather than migrated.
  "lib/components/inverter/_shared/ev-charger-body.svelte",
  "lib/components/inverter/_shared/soc-gauge.svelte",
  "lib/components/inverter/tou-slot-editor.svelte",
  "lib/components/prices/negative-window-day.svelte",
  "lib/components/settings/display-form.svelte",
  "lib/components/settings/installed-profiles-list.svelte",
  "lib/components/settings/inverter-form.svelte",
  "lib/components/settings/tariff-form.svelte",
  "routes/(app)/controls/controls-panel.svelte",
].sort();

/**
 * The two remaining copies of the empty-state block live in page roots owned
 * by the concurrent page-shell migration; they move with those files, not with
 * this one.
 */
const EMPTY_STATE_COPIES_IN_PAGE_ROOTS = [
  "routes/(app)/controls/+page.svelte",
  "routes/(app)/history/+page.svelte",
];

describe("the section recipe lives in one place", () => {
  test("the scan sees the whole app, not an empty glob", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("lib/components/layout/section.svelte");
  });

  test("no component outside the layout primitives writes a section heading", () => {
    const offenders = files.filter((f) => !isPrimitive(f) && writesOwnHeading(read(f)));
    expect(offenders).toEqual(HEADINGS_NOT_YET_MIGRATED);
  });

  test("no component outside the layout primitives frames its own section card", () => {
    const offenders = files.filter((f) => !isPrimitive(f) && drawsOwnCard(read(f)));
    expect(offenders).toEqual(CARDS_NOT_YET_MIGRATED);
  });

  test.each(MIGRATED_SECTIONS)("%s renders Section instead of a card of its own", (file) => {
    const code = read(file);
    expect(code).toContain("layout/section.svelte");
    expect(code).toMatch(/<Section[\s>]/);
    expect(code).not.toMatch(/<section[\s>]/);
  });

  // Five of the six variants moved unconditionally; the sixth's forceMount +
  // reduced-motion handling is now `section-body.svelte`, so no migrated file
  // may keep a collapsible of its own.
  test.each(MIGRATED_SECTIONS)("%s no longer drives its own collapsible", (file) => {
    expect(read(file)).not.toContain("Collapsible.");
  });
});

describe("the copied empty state", () => {
  test.each(MIGRATED_EMPTY_STATES)("%s renders EmptyState", (file) => {
    const code = read(file);
    expect(code).toContain("layout/empty-state.svelte");
    expect(code).toMatch(/<EmptyState[\s/>]/);
  });

  // Subset, not equality: the last two copies live in page roots the concurrent
  // page-shell migration owns, and they go when that lands. A copy anywhere
  // else — including a new one — still fails here.
  test("no copy survives outside the page roots the shell migration owns", () => {
    const offenders = files
      .filter((f) => read(f).includes(COPIED_EMPTY_STATE))
      .filter((f) => !EMPTY_STATE_COPIES_IN_PAGE_ROOTS.includes(f));
    expect(offenders).toEqual([]);
  });
});

describe("statistics sections stay controlled", () => {
  const statisticsSection = () => read("routes/(app)/statistics/statistics-section.svelte");

  // `open` here is a $derived of customize mode, a viewer override and a stored
  // preference. A $derived cannot be `bind:`-ed, and a write from inside the
  // section would survive only until the next recompute.
  // Each of these is read off the opening tag itself: the three-state open
  // contract is a set of props Section actually receives, and a file that
  // dropped them while still explaining the contract in a comment would have
  // shipped an uncontrolled section that fights its own $derived.
  test("it hands Section a computed open state and takes the change back by callback", () => {
    const code = statisticsSection();
    const tag = openTagOf(code, "Section");
    expect(tag, "statistics-section renders no Section").not.toBeNull();
    expect(hasAttribute(tag!, "controlled")).toBe(true);
    expect(tag).toMatch(/(?:^|\s)open=\{open\}/);
    expect(tag).toMatch(/onOpenChange=\{\(v\) => \(viewerOpen = v\)\}/);
    expect(code).not.toContain("bind:open");
  });

  test("customize mode still reaches the shell's dashed and dimmed states", () => {
    const code = statisticsSection();
    expect(code).toMatch(/dashed=\{customize\.active\}/);
    expect(code).toMatch(/dimmed=\{customize\.sectionHidden\(id\)\}/);
  });
});

describe("the chart panel nests without doubling the chrome", () => {
  const chartPanel = () => read("routes/(app)/statistics/chart-panel.svelte");

  // On the tag, not anywhere in the file: without the prop the panel draws a
  // second border and a second pad inside the section that already has both,
  // and a comment saying "this panel is nested" changes nothing on screen.
  test("it asks Section to drop its border and pad on a phone", () => {
    const tag = openTagOf(chartPanel(), "Section");
    expect(tag, "chart-panel renders no Section").not.toBeNull();
    expect(hasAttribute(tag!, "nested")).toBe(true);
  });

  // Three header items spread by justify-between put the summary in the middle
  // of the row, where it read as a second title. Section gives one right-hand
  // cluster, so summary and switcher travel together.
  test("its summary and switcher move into the header action cluster", () => {
    const actions = chartPanel().match(/\{#snippet actions\(\)\}[\s\S]*?\{\/snippet\}/);
    expect(actions).not.toBeNull();
    expect(actions![0]).toContain("<PanelActions");

    // The pair itself lives one file down — the panel's template branched four
    // ways with them inline, which put it over the complexity gate.
    const cluster = read("routes/(app)/statistics/panel-actions.svelte");
    expect(cluster).toContain("<PanelSummary");
    expect(cluster).toContain("<RangeSwitcher");
  });

  // The window used to be glued onto the title with an em dash; Section has a
  // caption line for exactly this, so the joiner helper goes with it.
  test("the plotted window becomes Section's caption, not part of the title", () => {
    const code = chartPanel();
    expect(code).toMatch(/caption=\{view\?\.caption \?\? caption\}/);
    expect(code).not.toContain("panelHeading");
  });
});
