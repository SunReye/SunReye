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
 * One attribute's worth of tag text: a bare character, a quoted value, or a
 * braced expression. Braces nest one level deep because that is how Svelte
 * writes an object literal into an attribute — `use:inView={{ onEnter: … }}`,
 * `transition:fade={{ duration: 200 }}`. A single-level pattern stops at the
 * INNER `}`, so it ends the tag early and then finds no tag at all.
 */
const ATTRIBUTE = `(?:[^<>"'{]|"[^"]*"|'[^']*'|\\{(?:[^{}]|\\{[^{}]*\\})*\\})`;

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
  const match = code.match(new RegExp(`<${name}${ATTRIBUTE}*>`));
  return match ? match[0] : null;
}

/**
 * Whether `tag` carries `attribute` — shorthand (`nested`), valued
 * (`nested={x}`), or Svelte's value shorthand (`{caption}`, which passes the
 * binding of that name and is the same prop by another spelling.)
 */
function hasAttribute(tag: string, attribute: string): boolean {
  return new RegExp(`(?:^|\\s)\\{?${attribute}(?=[\\s/>=}])`).test(tag);
}

/**
 * The single open tag that carries `attribute` — element name included.
 *
 * "The file still says `use:inView`" is true of a comment, and of the action
 * left on a child that is unmounted half the time. Which element the observer
 * sits on is the whole behaviour, so the tag itself is what gets asserted.
 */
function tagCarrying(code: string, attribute: string): string | null {
  for (const tag of code.matchAll(OPEN_TAG)) {
    if (hasAttribute(tag[0], attribute)) return tag[0];
  }
  return null;
}

/** The body of `{#snippet name()}…{/snippet}`, or null when there is none. */
function snippetBody(code: string, name: string): string | null {
  const match = code.match(new RegExp(`\\{#snippet ${name}\\(\\)\\}([\\s\\S]*?)\\{/snippet\\}`));
  return match ? match[1] : null;
}

/** Elements with no closing tag, so they never enclose anything. */
const VOID_ELEMENTS = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;

/**
 * The markup, with the parts that are not the rendered tree removed. Snippet
 * bodies go too: a snippet is rendered wherever the callee decides, so counting
 * its tags as enclosing anything below it is simply wrong.
 */
function template(source: string): string {
  return stripSnippets(
    source.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, ""),
  ).trim();
}

/**
 * Snippet blocks removed, nesting counted.
 *
 * A lazy `\{#snippet[\s\S]*?\{/snippet\}` closes an OUTER snippet on an inner
 * one's terminator — profile-step's row snippet contains an `actions` snippet —
 * and leaves the outer's tail in the markup, where it becomes the template's
 * root element and every claim about the root is then made about a fragment.
 */
function stripSnippets(markup: string): string {
  const OPEN = "{#snippet";
  const CLOSE = "{/snippet}";
  let out = "";
  let depth = 0;
  for (let i = 0; i < markup.length; ) {
    if (markup.startsWith(OPEN, i)) {
      depth++;
      i += OPEN.length;
    } else if (markup.startsWith(CLOSE, i)) {
      depth = Math.max(0, depth - 1);
      i += CLOSE.length;
    } else {
      if (depth === 0) out += markup[i];
      i++;
    }
  }
  return out;
}

/**
 * The open tags enclosing `needle`, outermost first. Same shape as
 * `enclosingTags` in `routes/(app)/page-shells.test.ts`, kept local for the
 * reason `openTagOf` is.
 *
 * Which component WRAPS another is a claim about context: `Tabs.List` only
 * finds its root through the render tree, so "the file contains a Tabs.Root"
 * passes a file whose root is a sibling of the section and whose triggers are
 * inert.
 */
function enclosingTags(markup: string, needle: string): string[] {
  const at = markup.indexOf(needle);
  expect(at, `${needle} is not in this template`).toBeGreaterThan(-1);
  const open: string[] = [];
  const tags = markup
    .slice(0, at)
    .matchAll(new RegExp(`<(/?)([A-Za-z][\\w.]*)(${ATTRIBUTE}*?)(/?)>`, "g"));
  for (const [tag, closing, name, , selfClosing] of tags) {
    if (closing) open.pop();
    else if (!selfClosing && !VOID_ELEMENTS.test(name)) open.push(tag);
  }
  return open;
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

/**
 * Phase 2.4's own batch: the bespoke cards that were still framing themselves
 * and writing their own heading after the six section variants had merged.
 *
 * Separate from {@link MIGRATED_SECTIONS} because the collapsible rule below
 * does not apply to them — `profile-step` keeps a `Collapsible.Root`, and it is
 * not a section collapse but the "no inverter?" disclosure INSIDE the card.
 */
const MIGRATED_BESPOKE_CARDS = [
  "lib/components/inverter/custom-chart-card.svelte",
  "lib/components/inverter/energy-split-chart.svelte",
  "lib/components/inverter/entity-history-card.svelte",
  "lib/components/inverter/time-of-use.svelte",
  "lib/components/setup/activate-step.svelte",
  "lib/components/setup/profile-step.svelte",
  "lib/components/statistics/hour-weekday-heatmap.svelte",
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
  // The one survivor of the phase-2.4 backlog, and it is a deliberate one.
  // `Section` frames with `border border-border` and heads with a muted
  // uppercase title STRING; the danger zone frames with `border-destructive/50`
  // and heads with a destructive-coloured warning-icon row. Neither the frame
  // tone nor the icon is expressible through any prop `Section` has, and both
  // are the whole affordance that separates "this wipes your history" from a
  // neutral card — the reader is one click from an irreversible reset. Moving
  // it needs a `tone` on `sectionShellClass` AND on `section-header`, which is
  // a primitives change, not a migration; `the danger zone earns its
  // exemption` below pins that the weight is really there and not a comment.
  "lib/components/settings/danger-zone-form.svelte",
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
  // Chrome, not cards. Each is a bordered thing SMALLER than a section: the
  // diagram's charger and battery badges, a price pill, a note paragraph, the
  // pinned-profile strip, the timezone preview readout, one tariff band row,
  // one time-of-use slot row, the dashed "no inverter?" disclosure inside the
  // now-migrated profile step, and the lock banner that already sits inside
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
  "lib/components/setup/profile-step.svelte",
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

  test.each(MIGRATED_BESPOKE_CARDS)("%s renders Section instead of a card of its own", (file) => {
    const code = read(file);
    expect(code).toContain("layout/section.svelte");
    expect(code).toMatch(/<Section[\s>]/);
    expect(code).not.toMatch(/<section[\s>]/);
  });
});

/**
 * Phase 2.4, per card. The census above says "no file frames a card any more";
 * these say the CONTENT survived the move — a card that dropped its controls,
 * its aria-label or its lazy mount into the diff would still pass the census.
 */
describe("the bespoke cards keep what made them worth keeping", () => {
  // Both of these render many-up inside a section that is already inside the
  // page shell (/history's metric group, /statistics' section, the custom-chart
  // section), so three frames and three pads at 390px is the exact case
  // `nested` exists for.
  test.each([
    "lib/components/inverter/custom-chart-card.svelte",
    "lib/components/inverter/entity-history-card.svelte",
    "lib/components/inverter/energy-split-chart.svelte",
    "lib/components/statistics/hour-weekday-heatmap.svelte",
  ])("%s asks Section to drop its frame on a phone", (file) => {
    const tag = openTagOf(read(file), "Section");
    expect(tag, `${file} renders no Section`).not.toBeNull();
    expect(hasAttribute(tag!, "nested")).toBe(true);
  });

  describe("a custom chart card", () => {
    const card = () => read("lib/components/inverter/custom-chart-card.svelte");

    // The header held title + edit + delete spread by `justify-between`. They
    // collapse into Section's one right-hand cluster, and the two icon-only
    // buttons are unreachable to a screen reader without their labels — which
    // is why the labels are read off the cluster, not off the file.
    test("its edit and delete controls move into the header cluster, labelled", () => {
      const actions = snippetBody(card(), "actions");
      expect(actions, "custom-chart-card passes Section no actions").not.toBeNull();
      expect(actions!).toContain("aria-label={msg.chart_edit_chart()}");
      expect(actions!).toContain("aria-label={msg.chart_delete_chart()}");
      expect(actions!).toContain("onclick={onEdit}");
      expect(actions!).toContain("onclick={onDelete}");
    });

    test("the chart's name is the section title, not a heading of its own", () => {
      expect(openTagOf(card(), "Section")).toContain("title={chart.name}");
    });
  });

  describe("an entity history card", () => {
    const card = () => read("lib/components/inverter/entity-history-card.svelte");

    // `Section` takes neither a `class` nor a `use:` action, and the observer
    // has to sit on the card's outermost box or 100+ charts all mount at once.
    // So the root is a bare wrapper — bare being the load-bearing word: a
    // wrapper that grew a frame would draw a second border around the section.
    test("the lazy-mount observer sits on a wrapper that draws nothing", () => {
      const code = card();
      const tag = tagCarrying(code, "use:inView");
      expect(tag, "nothing carries the in-view action any more").not.toBeNull();
      expect(tag!).toMatch(/^<div[\s>]/);
      // The handlers are what this migration cares about; the retention-band
      // margins beside them are the scroll-perf change's business, not this
      // file's.
      expect(tag!).toContain("onEnter: enter");
      expect(tag!).toContain("onLeave: leave");
      for (const [, value] of tag!.matchAll(/class="([^"]*)"/g)) {
        expect(value).not.toMatch(FRAME);
        expect(value).not.toMatch(PADDING);
      }
      expect(enclosingTags(template(code), "<Section")).toContain(tag!);
    });

    // The live reading was the right half of the old header row; it is the
    // header action now. Dropped, the card shows history with no current value.
    test("the live readout is the header action", () => {
      // The readout moved into `metric-card-actions.svelte` when the
      // add-to-chart menu joined it there; what matters to this migration is
      // still that the live value is the section's header action and not a
      // second row of its own.
      const actions = snippetBody(card(), "actions");
      expect(actions, "entity-history-card passes Section no actions").not.toBeNull();
      expect(actions!).toContain("<MetricCardActions");
      expect(read("lib/components/inverter/_shared/metric-card-actions.svelte")).toMatch(
        /<MetricReadout\s[^>]*\{value\}[^>]*\{unit\}/,
      );
    });
  });

  describe("the energy split chart", () => {
    const chart = () => read("lib/components/inverter/energy-split-chart.svelte");

    // "Energy split — this month, by day" was one string in one `<h2>`; the
    // window is Section's caption line now, as it is on every chart panel.
    test("the plotted window becomes the caption, not part of the title", () => {
      const tag = openTagOf(chart(), "Section");
      expect(tag).toContain("title={msg.chart_energy_split()}");
      expect(hasAttribute(tag!, "caption")).toBe(true);
      // The template, not the file: the em dash survives in the comment that
      // records why it went, and that comment is not on screen.
      expect(template(chart())).not.toContain("—");
    });

    // The chart comes and goes with its data, and a transition needs an element
    // this file owns — the same wrapper chart-panel spends it on.
    test("its fade sits on a wrapper, since the root is a component now", () => {
      const wrappers = enclosingTags(template(chart()), "<Section");
      expect(wrappers.some((tag) => /^<div[^>]*transition:fade/.test(tag))).toBe(true);
    });

    test("the kWh/percent switcher is the header action", () => {
      expect(snippetBody(chart(), "actions")).toContain("<RangeSwitcher");
    });
  });

  describe("the time-of-use editor", () => {
    const tou = () => read("lib/components/inverter/time-of-use.svelte");

    // The tab list is a header action, and a `Tabs.List` finds its root through
    // the RENDER tree. Rendered from Section's header while `Tabs.Root` sits
    // beside the section rather than around it, the triggers find no context
    // and the editor cannot be switched at all — so the nesting is the test.
    test("Tabs.Root wraps the Section, so the tab list in the header has a root", () => {
      const code = tou();
      expect(snippetBody(code, "actions")).toContain("<Tabs.List");
      expect(enclosingTags(template(code), "<Section").map((t) => t.slice(0, 11))).toContain(
        "<Tabs.Root ",
      );
    });

    // Voltage vs SOC packs are driven by different targets, and the sentence
    // saying which is the caption line now rather than a paragraph the header
    // row had to make room for.
    test("the voltage/SOC sentence becomes the section caption", () => {
      expect(openTagOf(tou(), "Section")).toMatch(/caption=\{/);
      expect(tou()).toContain("m.tou_schedule_desc_voltage()");
      expect(tou()).toContain("m.tou_schedule_desc_soc()");
    });
  });

  describe("the hour-by-weekday heatmap", () => {
    const heatmap = () => read("lib/components/statistics/hour-weekday-heatmap.svelte");

    // The metric switcher lives in the header, and the panel deliberately stays
    // mounted when the chosen metric is flat — unmounting strands the reader on
    // a choice they cannot undo. Both of those are one claim: the switcher is
    // in the header, and the header is outside the `hasData` branch.
    test("the metric switcher is the header action and outlives an empty metric", () => {
      const code = heatmap();
      const actions = snippetBody(code, "actions");
      expect(actions).toContain("<RangeSwitcher");
      expect(actions).toContain("bind:value={metric}");
      expect(actions!.includes("{#if hasData}")).toBe(false);
    });

    test("its subtitle becomes the section caption", () => {
      expect(openTagOf(heatmap(), "Section")).toContain("caption={m.statistics_heatmap_caption()}");
    });
  });

  // These two render OUTSIDE the (app) shell — /setup has no PageShell above
  // it — so the card is the only thing padding them. A migration that also
  // added a pad of its own would double it exactly where there is least room.
  describe.each([
    "lib/components/setup/activate-step.svelte",
    "lib/components/setup/profile-step.svelte",
  ])("%s stands alone in the setup wizard", (file) => {
    test("it roots at Section, so the card is the whole of its gutter", () => {
      const markup = template(read(file));
      expect(markup.startsWith("<Section")).toBe(true);
      expect(markup.endsWith("</Section>")).toBe(true);
      // Nothing wraps it: a wrapper here is a pad or a frame the wizard has no
      // shell to absorb, and it lands on the narrowest screen in the product.
      expect(enclosingTags(markup, "<Section")).toEqual([]);
    });
  });

  // The exemption above is a claim about pixels, so it is checked like one: the
  // day someone quietly repaints this card in `border-border`, the reason
  // written next to its allowlist entry stops being true and this goes red.
  test("the danger zone earns its exemption", () => {
    const code = read("lib/components/settings/danger-zone-form.svelte");
    const frame = openTagOf(code, "section");
    expect(frame, "the danger zone no longer roots at a section").not.toBeNull();
    expect(frame!).toMatch(/class="[^"]*\bborder-destructive\//);
    expect(code).toMatch(/<h2[^>]*>/);
    expect(code).toContain("text-destructive");
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
