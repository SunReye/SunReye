---
name: layout-system
description: The SunReye dashboard's layout vocabulary — page shells, section cards, grids, spacing tokens, breakpoint policy, mobile floors, and the live-value ownership rule. Use when writing or editing any .svelte file in apps/web, adding a route, building a card or grid, sizing a chart, or wiring a live reading into a component.
---

# SunReye layout system

Measure, gutter, rhythm, columns and chart heights are decided once, in
`apps/web/src/lib/layout/tokens.ts`. Compose the primitives; do not type the literals. Nothing greps for a
hand-rolled literal any more — review and this skill hold the vocabulary; component tests hold what
it renders (see the last section).

## Tokens (`$lib/layout/tokens`)

| Token                        | Value                                        | Use                                        |
| ---------------------------- | -------------------------------------------- | ------------------------------------------ |
| `SHELL_WIDTH.narrow`         | `max-w-3xl`                                  | forms, lists, prose                        |
| `SHELL_WIDTH.wide`           | `max-w-7xl 2xl:max-w-384`                    | dashboards and charts                      |
| `SHELL_WIDTH.full`           | `max-w-none`                                 | bespoke full-bleed                         |
| `SHELL_PAD` / `SHELL_GAP`    | `p-4 sm:p-6` / `gap-6`                       | page gutter; section to section            |
| `SECTION_PAD` / `SECTION_GAP`| `p-3 sm:p-4` / `gap-4`                       | section gutter (steps DOWN on mobile); block to block |
| `CLUSTER_GAP`                | `gap-x-3 gap-y-2`                            | a wrapping row of controls                 |
| `GRID.tiles`                 | `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`  | dense readouts                             |
| `GRID.pair`                  | `grid-cols-1 lg:grid-cols-2`                 | two blocks side by side                    |
| `GRID.wall`                  | `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`  | many equal cards                           |
| `CHART_BOX` / `CHART_BOX_SHORT` | `h-48 sm:h-64` / `h-44 sm:h-55`           | every chart plot box                       |
| `TAP`                        | `relative after:absolute after:-inset-3.5`   | 44px hit area for an icon-only trigger     |

The shell pads *up* and the section pads *down* because they nest: three `p-4`s at 390px cost 50px
per side, a quarter of the screen. Grid variants all carry a base column count and `[&>*]:min-w-0`.

**Breakpoints: `sm` / `lg` / `xl` / `2xl` only.** `md:` is banned in first-party layout code; the
settings nav rail is the single grandfathered exception and says so in the file.

## Primitives (`$lib/components/layout/`)

- `PageShell` — `width="narrow"|"wide"|"full"` (state it, even when it matches the default),
  `lead` snippet (back link — where you came from), `toolbar` snippet (page controls). Takes **no
  `class` prop**; a page needing a bespoke root asks for `width="full"` and owns its markup.
- `Section` — `title`, `caption?`, `actions?` snippet, `collapsible?`, `open?` + `controlled?` +
  `onOpenChange?`, `dashed?`/`dimmed?` (customize mode), `nested?` (drops border and pad below `sm`
  when this card sits inside another), `fullscreen?` (the card holds a chart and its header offers
  to take the whole screen).
- `SectionGrid` — `variant="tiles"|"pair"|"wall"`.
- `EmptyState` — `message`, `icon?`, `action?` snippet. `min-h-32` floor, not a fixed height.

- `ChartFullscreen` — `title`, children. **Only** for a chart with no section card around it (a
  dialog, a panel). A chart in a card uses `<Section fullscreen>` instead.

`SectionHeader` / `SectionActions` / `SectionBody` / `FullscreenTrigger` are internals of `Section`;
do not import them directly.

### Charts

Every chart gets a full-screen control. Put the control on the **plot**, not on a card holding several plots. The expanded classes
live in `expandedSectionClass` / `expandedChartClass` and are written out **literally** — Tailwind
scans source text, so a class name built with `map`/`join` reaches the DOM with no rule behind it
and silently does nothing.

A metric card can hold a **draft** overlay — extra metrics, unsaved, added from "compare with…" in
its header. It renders through `OverlayChartView`, the same component a saved custom chart uses; the
draft is component state that lasts until it is cleared or saved, and it is saved by seeding the
existing editor.

Series colours come from `$lib/inverter/chart-palette` (`paletteColor(i)` / `colorVar(id)`) — eight
categorical hues. Write `var(--chart-N)`, never `var(--color-chart-N)`: the `--color-` spelling is
Tailwind's `@theme inline` mapping and is dropped unless Tailwind sees that exact name in source.

Never hand the Fullscreen API anything but `document.documentElement` (`fullscreenTarget()`). Native
full screen renders only that element's subtree, and every tooltip/dropdown/select/popover in this
app is portalled to `document.body` — full-screening a card makes all of them invisible.

### Page template

```svelte
<script lang="ts">
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import Section from '$lib/components/layout/section.svelte';
	import SectionGrid from '$lib/components/layout/section-grid.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import * as Chart from '$lib/components/ui/chart';
	import { CHART_BOX } from '$lib/layout/tokens';
	import * as m from '$lib/paraglide/messages';
</script>

<PageShell width="wide">
	{#snippet toolbar()}
		<RangeSwitcher bind:value={range} {options} />
	{/snippet}

	<Section title={m.statistics_section_energy()} collapsible>
		<SectionGrid variant="tiles">
			{#each tiles as tile (tile.id)}
				<StatTile {...tile} />
			{/each}
		</SectionGrid>
	</Section>

	<Section title={m.statistics_section_costs()}>
		{#if rows.length === 0}
			<EmptyState message={m.logs_empty()} />
		{:else}
			<Chart.Container {config} class="{CHART_BOX} w-full min-w-0">…</Chart.Container>
		{/if}
	</Section>
</PageShell>
```

## Mobile floors (designed at 412x961)

- Every grid states its **phone** column count. `grid sm:grid-cols-2` is one column below `sm` by
  accident, not by decision.
- Touch targets reach 44px: interactive sizes gain a step below `sm` and hand it back
  (`h-9 sm:h-8`, `size-9 sm:size-8`). An icon-only trigger spends `TAP`.
- No type below `text-xs` (12px) on a phone. Tighter desktop scale goes `text-xs sm:text-[0.65rem]`.
- Labels wrap; they do not `truncate`. Check the German string — it is the long one.
- Charts use `CHART_BOX`, and their loading/empty state uses the same box so the page cannot jump.
- Chart gutters follow the **measured** plot width (`bind:clientWidth` → `chartPaddingFor`,
  `xTickSpacingFor`, `stackedBarProps`), never a breakpoint.
- Nothing scrolls sideways: `min-w-0` on grid children, popovers capped at the available width.
- Stacked reading order is a decision — `order-*` with an `xl:order-*` pair.
- A segmented switcher past 3 options (`needsCompactSwitcher`) offers a `Select` on a phone.

## Live-value ownership (`$lib/live/ownership.ts`)

**A measured register is owned by the feed that reads the register; a decided value is owned by the
feed that decided it. No consumer merges the two.**

- Lease the feeds while mounted (`$effect(() => livePlant.lease())`) and read through
  `livePlant.read('<id>')`, which returns a `Reading` carrying freshness.
- Never `??` across topics (`liveRole('load.power') ?? status.loadW` showed a 30 s engine decision
  gliding at the 1 Hz metrics cadence — alive-looking and wrong).
- Never peel `.value` off a `Reading`; hand it to `animatable()`, which withholds a stale number
  from the glide.
- Adding a value means adding it to `OWNERSHIP` under exactly one topic. Two owners throws.

## The tests that prove the layout

The vocabulary itself (which token a grid spends) is not tested — a regex over `.svelte` source
passed for broken layouts and failed for renames, and those tests were deleted. What a user sees
is tested by mounting the component in Chromium (`bun run test:components`,
`*.svelte.test.ts`; `apps/web/TESTING.md`):

| File | Proves |
| ---- | ------ |
| `lib/layout/tokens.test.ts` | the class builders compose; `tapTargetPx`, `tileContentWidthPx`, the compact-switcher boundary |
| `components/layout/section.svelte.test.ts` | fold/unfold, 44px caret, a long German title wraps at 390px with controls hard right, fullscreen fills the viewport |
| `components/layout/section-header.svelte.test.ts`, `page-shell.svelte.test.ts`, `panel-readout-row.svelte.test.ts` | header and toolbar rows: chrome stays on the right edge, stacks on a phone |
| `components/layout/chart-fullscreen.svelte.test.ts` | a chart in a transformed dialog still takes the whole screen, exit is reachable |
| `routes/(app)/statistics/stat-tiles.svelte.test.ts` | 2 tiles per row at 390px, 4 at lg, a long total cannot widen its column, 44px info target |
| `components/inverter/range-switcher.svelte.test.ts`, `period-navigator.svelte.test.ts` | phone switchers fit one row, select ↔ buttons drive one value |

A new card, grid or switcher with phone behaviour gets a component test that sets
`page.viewport(390, 844)` and measures it.

Full rationale: `apps/web/DESIGN.md`.
