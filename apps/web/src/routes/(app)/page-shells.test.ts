/**
 * Census of every page root in the workspace.
 *
 * Phase 2.3 put all seven routes on `PageShell`. Nothing stops the eighth from
 * hand-typing `mx-auto max-w-5xl p-4 sm:p-6` again — that is exactly how the
 * codebase arrived at five vertical rhythms and four content measures — and the
 * real enforcement gate (raw class strings in routes vs. the tokens) is not
 * built yet. This census is the interim gate: it discovers the page roots from
 * disk rather than from a list, so a new `+page.svelte` fails here until someone
 * states, in {@link EXPECTED}, which measure it is on and why.
 *
 * Source-text assertions, in the style of `lib/layout/primitives.test.ts`:
 * Svelte runes do not run under `bun test` and there is no render harness, so
 * the connection between a route and the shell is proven by reading the route.
 * Every case below pins the shell to the template ROOT — "PageShell appears
 * somewhere in the file" would pass a page that nests one inside a hand-rolled
 * container, which is the failure this is meant to catch.
 */

import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));

/**
 * How a page root is allowed to be built.
 *
 * - `narrow` / `wide` / `full` — renders `<PageShell>` at that measure.
 * - `nested` — a settings panel; the settings layout supplies the shell.
 * - `bespoke` — a documented exception that owns its own root element but still
 *   spends the shell tokens (see the overview case below).
 * - `redirect` — a `goto` stub with no markup at all.
 */
type Shape = "narrow" | "wide" | "full" | "nested" | "bespoke" | "redirect";

const PANELS = [
  "access",
  "api-keys",
  "automations",
  "danger",
  "devices",
  "display",
  "logs",
  "mqtt",
  "plant",
  "prices",
  "profiles",
  "sensors",
  "tariff",
  "users",
  "weather",
] as const;

const EXPECTED: Record<string, Shape> = {
  // The kiosk overview pins to the viewport on lg+ and cannot be a PageShell:
  // the grid, the height and the overflow all belong on the very element
  // PageShell owns, and PageShell deliberately takes no `class`.
  "+page.svelte": "bespoke",
  "controls/+page.svelte": "narrow",
  // Both automations routes are `wide`, not just the detail page. The list and
  // its own detail page disagreeing on the measure was the most visible symptom
  // of the drift, and peak-shaving cannot go narrow — its xl two-column split
  // never fires inside a 48rem measure.
  "automations/+page.svelte": "wide",
  "automations/peak-shaving/+page.svelte": "wide",
  "history/+page.svelte": "wide",
  "statistics/+page.svelte": "wide",
  // /costs moved to /statistics; the stub only redirects.
  "costs/+page.svelte": "redirect",
  // Settings has no landing screen of its own.
  "settings/+page.svelte": "redirect",
  // The pre-2.0 inverter panel; its two halves live in Devices and Plant now.
  "settings/inverter/+page.svelte": "redirect",
  // Settings panels render INSIDE the settings layout's shell. A panel that
  // grew a shell of its own would double the gutter and cap the measure twice.
  ...Object.fromEntries(PANELS.map((p) => [`settings/${p}/+page.svelte`, "nested"] as const)),
};

async function read(file: string): Promise<string> {
  return await Bun.file(APP_DIR + file).text();
}

/**
 * The page's markup: everything outside `<script>`, comments and `{#snippet}`
 * definitions. Snippets are declarations, not layout — a page may declare one
 * above its root — so leaving them in would make the first tag in the file the
 * wrong answer to "what is the root element".
 */
function template(source: string): string {
  return source
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\{#snippet[\s\S]*?\{\/snippet\}/g, "")
    .trim();
}

/** The opening tag of the template's root element, attributes included. */
function rootTag(markup: string): string {
  const match = markup.match(/^<[A-Za-z][^]*?>/);
  expect(match).not.toBeNull();
  return match![0];
}

/** Elements with no closing tag, so they never enclose anything. */
const VOID_ELEMENTS = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;

/**
 * The open tags enclosing `needle`, outermost first.
 *
 * A layout is a nest of wrappers, and which wrapper carries a class is the
 * whole content of a claim like "the panel column is capped": asserting the
 * class appears anywhere in the file passes a layout that left it in a comment
 * or moved it onto the wrong element. Attribute values are consumed as units
 * so a `=>` inside `in:fly={…}` does not end a tag early.
 */
function enclosingTags(markup: string, needle: string): string[] {
  const at = markup.indexOf(needle);
  expect(at, `${needle} is not in this template`).toBeGreaterThan(-1);
  const open: string[] = [];
  const tags = markup
    .slice(0, at)
    .matchAll(/<(\/?)([A-Za-z][\w.]*)((?:[^<>"'{]|"[^"]*"|'[^']*'|\{[^{}]*\})*?)(\/?)>/g);
  for (const [tag, closing, name, , selfClosing] of tags) {
    if (closing) open.pop();
    else if (!selfClosing && !VOID_ELEMENTS.test(name)) open.push(tag);
  }
  return open;
}

const files = [...new Bun.Glob("**/+page.svelte").scanSync({ cwd: APP_DIR })].sort();
const sources = new Map(await Promise.all(files.map(async (f) => [f, await read(f)] as const)));
const appLayout = await read("+layout.svelte");
const settingsLayout = await read("settings/+layout.svelte");
const pageShell = await Bun.file(
  new URL("../../lib/components/layout/page-shell.svelte", import.meta.url),
).text();

describe("page root census", () => {
  // The point of scanning disk instead of listing files: a route added without
  // a decision about its measure lands here, not in review six months later.
  test("every page under (app) has a declared shape", () => {
    expect(files).toEqual(Object.keys(EXPECTED).sort());
  });

  const shelled = files.filter((f) => ["narrow", "wide", "full"].includes(EXPECTED[f] ?? ""));

  test.each(shelled)("%s roots at PageShell", (file) => {
    const markup = template(sources.get(file)!);
    expect(rootTag(markup)).toMatch(/^<PageShell\b/);
    expect(markup.endsWith("</PageShell>")).toBe(true);
    expect(sources.get(file)!).toContain("$lib/components/layout/page-shell.svelte");
  });

  // The measure is named on the tag even when it matches PageShell's default:
  // an unstated width is a width nobody chose, and this census cannot tell the
  // difference between "wide on purpose" and "never thought about it".
  test.each(shelled)("%s states its measure explicitly", (file) => {
    const width = rootTag(template(sources.get(file)!)).match(/width="([a-z]+)"/);
    expect(width).not.toBeNull();
    expect(width![1]).toBe(EXPECTED[file]!);
  });

  const nested = files.filter((f) => EXPECTED[f] === "nested");

  // Checked over the whole template, not just the root element: a panel that
  // appends a centred container further down has still capped the measure a
  // second time, and the reader only sees a panel that no longer lines up with
  // the fourteen beside it.
  test.each(nested)("%s is a bare panel — the settings layout owns the shell", (file) => {
    const source = sources.get(file)!;
    expect(source).not.toContain("PageShell");
    const markup = template(source);
    expect(markup).not.toMatch(/\bmx-auto\b/);
    expect(rootTag(markup)).not.toMatch(/\bmax-w-|\bp-4\b/);
  });

  test.each(files.filter((f) => EXPECTED[f] === "redirect"))("%s renders nothing", (file) => {
    expect(template(sources.get(file)!)).toBe("");
  });

  // The gutter literal is the tell for a hand-rolled shell: four of the five
  // rhythms in the old code opened with it. Tokens and PageShell both express
  // it, so a route spelling it out again has bypassed them.
  test.each(files)("%s spells no page gutter of its own", (file) => {
    expect(sources.get(file)!).not.toContain("p-4 sm:p-6");
  });
});

describe("the overview's documented exception", () => {
  const overview = () => sources.get("+page.svelte")!;

  test("still spends the shell's padding and rhythm tokens", () => {
    const root = rootTag(template(overview()));
    expect(root).toContain("{SHELL_PAD}");
    expect(root).toContain("{SHELL_GAP}");
  });

  // `lg:h-[calc(100svh-3.5rem)]` restated the header's height as a literal, in
  // a different file from the `h-14` that produced it. Nothing connected them:
  // change the header and the overview silently scrolls or clips.
  test("reads the header height from the layout instead of restating it", () => {
    const root = rootTag(template(overview()));
    expect(root).toContain("lg:h-[calc(100svh-var(--app-header-h))]");
    expect(root).not.toContain("3.5rem");
  });
});

/**
 * The toolbar row is one visual line, and nothing in it may claim the whole one.
 *
 * `lead` exists because the peak-shaving back link used to render below the
 * toolbar: two rows for one line of chrome. Render order is what the row-ordering
 * cases in `lib/components/layout/header-and-toolbar-rows.test.ts` pin, and order
 * alone does not carry the fix — wrap the lead render in `<div class="w-full">`
 * and it is still inside the row and still ahead of the controls, but the row is
 * `flex-wrap`, so a child that fills the line pushes the toolbar cluster onto a
 * second one and the two-row layout is back with every existing case green.
 *
 * What actually holds it is structural: the row's children are direct children
 * (no wrapper of any kind around the render sites) and none of them is sized to
 * fill the line.
 *
 * AMENDED, phone widths only, and deliberately: the controls cluster now carries
 * `max-sm:w-full`. Two reasons the one-line rule was not buying anything at
 * 390px. First, the cluster is a flex item, so shrink-to-fit made a child's own
 * `w-full` resolve against the cluster's CONTENT width — which is why the period
 * navigator stretched on /statistics (three controls widened the cluster) and did
 * not on /history (sole child), from identical markup. Second, the line was
 * already lost there: /statistics spent two rows regardless, and the one page
 * with a lead (/automations/peak-shaving) cannot fit a back link beside a period
 * navigator in 390px.
 *
 * So the rule now reads: at `sm` and up nothing in the row may fill the line, and
 * below `sm` only the controls cluster may. The lead render site still may not,
 * at any width — that is the case the block was originally written against.
 */
describe("the page shell's toolbar row stays one row", () => {
  const shellMarkup = template(pageShell);

  /**
   * Tailwind utilities that make a flex child take the whole line, so the next
   * child in a `flex-wrap` row starts a new one. Variant prefixes count —
   * `max-sm:w-full` wraps the row on exactly the screen the row was fixed for —
   * but only as whole classes: `max-w-full` and `grow-0` are not these.
   */
  const FILLS_THE_LINE =
    /(?:^|\s)(?:[a-z0-9-]+:)*(?:w-full|min-w-full|w-screen|basis-full|flex-1|grow|self-stretch)(?=\s|$)/;

  /** Every `class="…"` literal on an open tag inside `markup`, tag by tag. */
  function classesOfTags(markup: string): { tag: string; classes: string }[] {
    const out: { tag: string; classes: string }[] = [];
    for (const [tag] of markup.matchAll(
      /<[A-Za-z][\w.]*(?:[^<>"'{]|"[^"]*"|'[^']*'|\{[^{}]*\})*?\/?>/g,
    )) {
      out.push({ tag, classes: tag.match(/class="([^"]*)"/)?.[1] ?? "" });
    }
    return out;
  }

  const leadWrappers = enclosingTags(shellMarkup, "{@render lead?.()}");
  const toolbarWrappers = enclosingTags(shellMarkup, "{@render toolbar?.()}");

  // The row itself, identified by structure rather than by matching its class
  // string: it is the element the control cluster sits in, i.e. the last thing
  // still open around the toolbar once its own cluster is discounted.
  const row = toolbarWrappers.at(-2);

  test("the row exists and is the wrapping flex line both ends share", () => {
    expect(row).toBeDefined();
    expect(row).toContain("flex-wrap");
  });

  // Wrappers and full-width children are not the only way to split the row.
  // Turning the row itself into a column — `flex max-sm:flex-col` — puts the
  // back link above the live indicator on every phone, with no wrapper and no
  // banned child class anywhere. Same two-row layout, one token, and the rest
  // of this block would not notice.
  test("and stays a row at every width, on a phone above all", () => {
    expect(row).not.toMatch(/(?:^|\s)(?:[a-z0-9-]+:)*flex-col(?:-reverse)?(?=\s|"|$)/);
  });

  // The mutation this is written against: `{@render lead?.()}` wrapped in a
  // `<div>`. Any wrapper at all is a new flex item with its own sizing, and the
  // lead is a snippet — the page that passes it cannot see the wrapper to
  // correct for it. So the render site is a direct child of the row, full stop.
  test("the lead renders as a direct child of the row, in no wrapper of its own", () => {
    expect(leadWrappers.at(-1)).toBe(row);
    expect(leadWrappers).toHaveLength(toolbarWrappers.length - 1);
  });

  // The controls do get one wrapper — `ml-auto` needs an element to sit on —
  // and it is the only one.
  test("the controls sit in exactly one cluster, inside that same row", () => {
    expect(toolbarWrappers.at(-1)).toContain("ml-auto");
    expect(toolbarWrappers.at(-2)).toBe(row);
  });

  test("nothing in the row fills the line from sm up", () => {
    // `max-sm:`-prefixed fillers are the phone carve-out above. Anything else —
    // unprefixed, or `sm:`/`lg:`-prefixed — still breaks the row on a laptop,
    // which is what this has always been for.
    const rowBlock = shellMarkup.slice(shellMarkup.indexOf(row!));
    const offenders = classesOfTags(rowBlock)
      .map((t) => ({ ...t, classes: t.classes.replace(/(?:^|\s)max-sm:\S+/g, " ") }))
      .filter((t) => FILLS_THE_LINE.test(t.classes))
      .map((t) => t.tag);
    expect(offenders).toEqual([]);
  });

  test("the controls cluster fills the line on a phone, and only there", () => {
    // Pinned rather than merely permitted: this is what makes the period
    // navigator the same width on /history as on /statistics. Drop it and the
    // cluster goes back to shrink-to-fit, where a sole child asking for `w-full`
    // gets its own content width.
    const cluster = toolbarWrappers.at(-1)!;
    const utilities = (cluster.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);
    expect(utilities).toContain("max-sm:w-full");
    expect(utilities).not.toContain("w-full");
  });

  test("the lead render site is never sized to fill the line, at any width", () => {
    // The original defect: a wrapper around the lead pushes the controls onto a
    // second row while every structural case stays green. No carve-out here.
    const leadTag = leadWrappers.at(0) ?? "";
    expect(FILLS_THE_LINE.test(leadTag.match(/class="([^"]*)"/)?.[1] ?? "")).toBe(false);
  });

  // The row's other half comes from the routes, and a lead snippet is markup
  // like any other: `<a class="w-full">` in the page wraps the row exactly the
  // same way a wrapper in the shell would. The shell cannot constrain it, so it
  // is pinned where it is written.
  const leads = files
    .map((file) => ({
      file,
      snippet: sources.get(file)!.match(/\{#snippet lead\(\)\}[\s\S]*?\{\/snippet\}/),
    }))
    .filter((l) => l.snippet !== null);

  test("there is a lead snippet in the routes to hold to this", () => {
    expect(leads.length).toBeGreaterThan(0);
  });

  test.each(leads.map((l) => l.file))(
    "%s's lead snippet claims no more than its content",
    (file) => {
      const snippet = leads.find((l) => l.file === file)!.snippet![0];
      const offenders = classesOfTags(snippet)
        .filter((t) => FILLS_THE_LINE.test(t.classes))
        .map((t) => t.tag);
      expect(offenders).toEqual([]);
    },
  );
});

describe("app layout", () => {
  const layout = appLayout;

  // At 412px /automations pushed past the viewport and the whole page could be
  // dragged sideways. Clip rather than scroll: a horizontal scrollbar on the
  // page is never the right answer, and `clip` (unlike `hidden`) does not turn
  // the main element into a scroll container that swallows sticky positioning.
  test("the content area clips horizontal overflow", () => {
    expect(layout).toMatch(/<main[^>]*overflow-x-clip/);
  });

  // One declaration, consumed by both the header's own height and the
  // overview's viewport calc — so they cannot drift apart.
  test("publishes the header height as a variable the header itself uses", () => {
    expect(layout).toContain("[--app-header-h:");
    expect(layout).toMatch(/<header[^>]*h-\[var\(--app-header-h\)\]/);
    expect(layout).not.toMatch(/<header[^>]*\bh-14\b/);
  });
});

describe("settings layout", () => {
  const layout = settingsLayout;

  test("roots at PageShell at the wide measure", () => {
    const markup = template(layout);
    expect(rootTag(markup)).toMatch(/^<PageShell\b/);
    expect(rootTag(markup)).toContain('width="wide"');
  });

  // Wide shell, capped panel: the nav rail eats a fixed 13rem, so an uncapped
  // panel column would run to a measure no form on it is readable at. The cap
  // has to be on an element that actually WRAPS the panel — one that only
  // mentions the class, in a comment or on a sibling, caps nothing.
  test("caps the panel column at the narrow measure", () => {
    const wrappers = enclosingTags(template(layout), "{@render children()}");
    expect(
      wrappers.filter((tag) => /class="[^"]*(?:^|\s)max-w-3xl(?:\s|")/.test(tag)),
    ).toHaveLength(1);
  });

  // The one grandfathered `md:` in the codebase (tokens.test.ts bans the rest):
  // the nav rail's 13rem column plus a usable panel does not fit below 768px,
  // and there is no sm/lg pair that lands the rail in the same place.
  test("keeps its md: rail breakpoint, and says why in the file", () => {
    expect(layout).toMatch(/md:grid-cols-\[13rem/);
    expect(layout).toMatch(/md:/);
    expect(layout.toLowerCase()).toContain("grandfathered");
  });
});
