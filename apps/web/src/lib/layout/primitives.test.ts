/**
 * Wiring proof for the layout primitives.
 *
 * The dashboard has no component-rendering harness (`apps/web/TESTING.md`), so
 * a test that only calls `pageShellClass()` passes just as happily with the
 * builder and the component disconnected — the primitive could hardcode its own
 * classes and nothing would notice. These cases read the component sources and
 * assert the connection itself: the primitives spend the tokens, and they hold
 * no competing layout literals of their own.
 */

import { describe, expect, test } from "bun:test";
import { tapTargetPx } from "./tokens";

const DIR = new URL("../components/layout/", import.meta.url);

async function source(file: string): Promise<string> {
  return await Bun.file(new URL(file, DIR)).text();
}

const pageShell = await source("page-shell.svelte");
const section = await source("section.svelte");
const sectionHeader = await source("section-header.svelte");
// The header row's right-hand cluster; split out when the full-screen toggle
// joined the collapse caret there and the header template crossed the gate.
const sectionActions = await source("section-actions.svelte");
const fullscreenTrigger = await source("fullscreen-trigger.svelte");
// The caret moved out of the actions cluster into its own row child, so that a
// phone can give the controls a centred row without dragging the caret along.
const collapseTrigger = await source("section-collapse-trigger.svelte");
const sectionBody = await source("section-body.svelte");
const emptyState = await source("empty-state.svelte");
const sectionGrid = await source("section-grid.svelte");

/** The `let { … } = $props()` destructuring pattern, brace to brace. */
function propsPattern(code: string): string {
  const match = code.match(/let \{[\s\S]*?\}:/);
  expect(match).not.toBeNull();
  return match![0];
}

describe("page shell", () => {
  test("spends the width builder rather than its own measure", () => {
    expect(pageShell).toContain("pageShellClass(width)");
    expect(pageShell).not.toMatch(/max-w-/);
  });

  test("takes no class prop — an escape hatch here is how the drift started", () => {
    expect(pageShell).not.toMatch(/\bclass\?:/);
  });

  // Refusing `class?:` only closes the front door. Svelte 5 drops props that
  // are not destructured, so the refusal holds today purely because there is no
  // rest element; adding one would forward `class`, `style` and every data
  // attribute straight onto the shell with no type ever mentioning it.
  test("and no rest element, which would forward one anyway", () => {
    expect(propsPattern(pageShell)).not.toContain("...");
  });

  test("the toolbar row uses the shared control-cluster gap", () => {
    expect(pageShell).toContain("{CLUSTER_GAP}");
  });
});

describe("section", () => {
  test("spends the section shell builder, with every shell state wired", () => {
    expect(section).toContain("sectionShellClass({ dashed, dimmed, nested })");
  });

  test("its open state comes from the tested decisions", () => {
    expect(section).toContain("sectionOpen({ collapsible, open })");
    expect(section).toContain("writesOwnOpen(controlled)");
  });

  // `sectionOpen` treats an unset `open` as "not yet decided, so show the
  // content" — the state a caller is in while a stored preference is still in
  // flight. A `$bindable(true)` default makes Svelte substitute `true` for
  // `undefined` before the component ever looks, so that branch would be
  // unreachable from here and the section would blank out and pop in instead.
  test("leaves `open` genuinely unset rather than defaulting it away", () => {
    expect(section).toContain("open = $bindable()");
  });

  // A controlled caller's `open` is a $derived it recomputes; a write from in
  // here survives until its next recompute and then snaps back.
  test("only writes `open` when it owns it", () => {
    expect(section).toMatch(/if \(writesOwnOpen\(controlled\)\) open = next/);
    expect(section.match(/\bopen = next\b/g)).toHaveLength(1);
  });

  test("delegates its header and body, keeping the card itself declarative", () => {
    expect(section).toContain("<SectionHeader");
    expect(section).toContain("<SectionBody");
  });
});

describe("section header", () => {
  test("the title truncates instead of pushing the header actions off-screen", () => {
    expect(sectionHeader).toMatch(/<h2 class="truncate/);
  });

  test("the header cluster uses the shared control-cluster gap", () => {
    expect(sectionHeader).toContain("{CLUSTER_GAP}");
  });

  // On a phone this caret is the only way to fold a section, so what matters is
  // the size of the area a thumb has to hit — not that a token name appears
  // next to the trigger. Read the icon the trigger actually renders and measure
  // what TAP makes of it: shrink either one and this fails.
  test("the collapse trigger's hit area measures 44px around the icon it renders", () => {
    expect(collapseTrigger).toMatch(/Collapsible\.Trigger[\s\S]*\{TAP\}/);
    const icon = collapseTrigger.match(/<CaretDown class="size-(\d+)/);
    expect(icon).not.toBeNull();
    const iconPx = Number(icon![1]) * 4;
    expect(tapTargetPx(iconPx)).toEqual({ width: 44, height: 44 });
  });

  // The trigger has no padding of its own, so a box-model class here would
  // silently become the real hit area and the measurement above would be a lie.
  test("and gets its reach from TAP alone, not from padding", () => {
    const trigger = collapseTrigger.match(/<Collapsible\.Trigger[\s\S]*?>/)![0];
    expect(trigger).not.toMatch(/\bp[xytblr]?-\d/);
  });

  // The full-screen toggle sits in the same cluster and is the same shape of
  // control: a bare 16px icon with nothing beside it to widen the hit area.
  // Sized differently from the caret it stands next to, it would read as a
  // second kind of thing rather than as more of the same row.
  test("the full-screen toggle is the same 44px target as the caret", () => {
    expect(fullscreenTrigger).toContain("{TAP}");
    const icons = [...fullscreenTrigger.matchAll(/<Arrows(?:In|Out) class="size-(\d+)/g)];
    expect(icons).toHaveLength(2);
    for (const icon of icons)
      expect(tapTargetPx(Number(icon[1]) * 4)).toEqual({ width: 44, height: 44 });
  });
});

describe("section body", () => {
  // The one variant that got this right; the other five moved unconditionally.
  test("the content transitions through forceMount + child, honouring reduced motion", () => {
    expect(sectionBody).toContain("forceMount");
    expect(sectionBody).toContain("prefers-reduced-motion: reduce");
    expect(sectionBody).toContain("slideParams(reduceMotion.current)");
    expect(sectionBody).toContain("transition:slide={slideConfig}");
  });

  test("a closed section renders nothing, so nothing hidden keeps fetching", () => {
    expect(sectionBody).toMatch(/\{#if contentOpen\}/);
  });
});

describe("empty state", () => {
  // The copied block reserved a fixed 160px — a fifth of a phone screen — to
  // say nothing, and clipped a two-line message with a button.
  test("reserves a floor, not a fixed height", () => {
    expect(emptyState).toContain("min-h-32");
    expect(emptyState).not.toContain("h-40");
  });
});

describe("section grid", () => {
  test("renders a token grid rather than its own columns", () => {
    expect(sectionGrid).toContain("GRID[variant]");
    expect(sectionGrid).not.toMatch(/class="[^"]*grid-cols-/);
  });
});

describe("breakpoint policy", () => {
  const all: [string, string][] = [
    ["page-shell", pageShell],
    ["section", section],
    ["section-header", sectionHeader],
    ["section-actions", sectionActions],
    ["fullscreen-trigger", fullscreenTrigger],
    ["section-body", sectionBody],
    ["empty-state", emptyState],
    ["section-grid", sectionGrid],
  ];

  test.each(all)("%s carries no md: prefix", (_name, code) => {
    expect(code).not.toMatch(/[\s"']md:/);
  });
});
