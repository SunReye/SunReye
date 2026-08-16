# DESIGN.md

## Design principles

### 1. Keep the shell stable

Global navigation, workspace chrome, and section headers should stay visually stable while only the inner content changes.

Use SvelteKit layouts for this, not repeated page markup.

### 2. Use routes for information architecture

If a view should be deep-linkable, shareable, bookmarkable, or reload safely, it should have its own route.

Tabs can be used as the visual control for navigation, but the content should still come from subroutes when the state matters.

### 3. Prefer subtle motion

Motion should clarify:

- what changed
- where content came from
- what area is interactive

Avoid decorative animation that delays reading or makes the app feel noisy.

### 4. Use the right menu for the job

Do not force every section into the same navigation shape.

This app uses:

- the sidebar for every top-level destination
- the settings rail for that section's fourteen panels
- a back link (or a breadcrumb, past one hop) for drill-in
- tabs only for two renderings of the same data

### 5. Preserve reading flow

This product is number-heavy: live power flows, day counters, cost and energy charts, automation
plans. Those screens should prioritize:

- readable widths
- clear section hierarchy
- sticky context where useful
- minimal layout jumping — an empty or loading block is the same height as the thing it replaces

### 5a. Spend the layout vocabulary, do not invent one

Measure, gutter, rhythm, grid columns and chart heights are decided once in
`src/lib/layout/tokens.ts` and rendered by the primitives in `src/lib/components/layout/`. Pages
compose those; they do not hand-roll containers. This is enforced by tests, not by review — see
"Styling and spacing guidance" below and the `layout-system` skill.

### 6. Prefer shadcn composition over custom UI

This repo should default to **shadcn-svelte-first** UI implementation.

- Always start from components in `apps/web/src/lib/components/ui/`.
- If an appropriate shadcn component exists upstream, add/install it before building a custom alternative.
- If no upstream shadcn component exists for the pattern, build a reusable local component instead of repeating custom styled markup in routes.
- Prefer `child` / render snippet composition when a shadcn component supports it.
- Do not replace available shadcn surfaces, inputs, dialogs, navigation, or form primitives with raw HTML.
- Raw HTML is acceptable for semantic document structure and content nested inside composed shadcn components.

---

## Recommended app layout hierarchy

### Root layout: app-wide shell

`apps/web/src/routes/+layout.svelte` owns app providers and global state only. The authenticated
chrome lives one level down.

### `(app)/+layout.svelte`: the workspace shell

- the sidebar (`lib/components/app-sidebar.svelte`) and the top header
- the header height, published once as `[--app-header-h: …]` and consumed by both the header and
  the overview's viewport calc — never restated as a literal in a second file
- `<main … overflow-x-clip>`: horizontal overflow is clipped, never scrolled

### Nested layouts: section shells

The one section shell today is `(app)/settings/+layout.svelte`: it renders the nav rail plus the
`PageShell`, so the fourteen settings panels are bare content with no shell of their own.

```text
apps/web/src/routes/(app)/
  +layout.svelte                  # sidebar + header + main
  +page.svelte                    # overview (bespoke, viewport-pinned on lg+)
  statistics/+page.svelte         # wide
  history/+page.svelte            # wide
  system/+page.svelte             # wide
  controls/+page.svelte           # narrow
  automations/
    +page.svelte                  # wide
    peak-shaving/+page.svelte     # wide, back link in PageShell's `lead`
  settings/
    +layout.svelte                # nav rail + the shell for every panel
    inverter/+page.svelte         # nested: no shell of its own
    …thirteen more panels
```

### Why this structure works

- the **root layout** owns providers
- the **(app) layout** owns app-wide chrome
- the **settings layout** owns the rail and the shell its panels share
- the **child pages** stay small and focused

`routes/(app)/page-shells.test.ts` discovers these pages from disk and fails on a new one until its
shape is declared, so the tree above cannot silently go stale.

---

## Menu patterns

## 1. Top navigation

The `(app)` header is thin on purpose: sidebar trigger, then the active page's title and subtitle,
which each page sets through the `pageHeader` store (`lib/page-header.svelte.ts`). It is not a
navigation surface — with a sidebar in place, a second row of destinations only splits the answer to
"where am I".

`navigation-menu` is deliberately NOT installed. Add it only if the header ever needs grouped
dropdown destinations, which it does not today.

---

## 2. Sidebar navigation

This is the app's primary navigation, and it is already built: `lib/components/app-sidebar.svelte`
inside `Sidebar.Provider` in `(app)/+layout.svelte` — `collapsible="icon"`, one monitoring group
whose items are role-gated, and Settings in the footer for admins.

Extend it rather than adding a parallel navigation surface: a new top-level screen is a new
`Sidebar.MenuItem`. Settings is the one exception — its fourteen panels would swamp the sidebar, so
they live in the settings layout's own rail.

---

## 3. Breadcrumb navigation

Use breadcrumbs for deep drill-in paths, near the page title, as a supplement to the sidebar.

There is exactly one drill-in today (`Automations / Peak shaving`), and it spends a back link in
`PageShell`'s `lead` snippet rather than a full breadcrumb — one hop does not need a trail. Reach
for `breadcrumb` (already installed) at two hops.

---

## 4. Tabs

Use tabs for sibling views of the **same data**, where the switch is a way of looking rather than a
place to be.

The app has exactly one, and it is the shape to copy: `lib/components/inverter/time-of-use.svelte`
switches the time-of-use schedule between `visual` and `table`. Same slots, two renderings, no URL
worth linking to.

```svelte
<script lang="ts">
	import * as Tabs from '$lib/components/ui/tabs';
	import * as m from '$lib/paraglide/messages';
</script>

<Tabs.Root value="visual">
	<Tabs.List variant="line">
		<Tabs.Trigger value="visual">{m.tou_tab_visual()}</Tabs.Trigger>
		<Tabs.Trigger value="table">{m.tou_tab_table()}</Tabs.Trigger>
	</Tabs.List>
	<Tabs.Content value="visual" class="pt-2">…</Tabs.Content>
	<Tabs.Content value="table" class="pt-2">…</Tabs.Content>
</Tabs.Root>
```

### Tabs rule for this app

Use `Tabs` for **local content switching inside a route**. Use SvelteKit **subroutes** for anything
that deserves its own URL — the sidebar and the settings rail are both link navigation, not tabs.
Never repurpose the ARIA tabs widget for page navigation: style links to look like tabs instead.

Three more distinctions this app has already had to make:

- **Tabs vs. a range switcher.** Picking "7 days / 30 days / 12 months" is not a tab, it is a
  parameter. That is `RangeSwitcher`, which becomes a `Select` on a phone past three options
  (`needsCompactSwitcher`).
- **Tabs vs. collapsible sections.** Long screens like /statistics stack `Section`s the reader
  folds, so several groups can be open at once. Tabs would hide the comparison.
- **Tabs vs. a subroute.** Peak shaving is a screen with its own live feeds and its own toolbar,
  so it is `automations/peak-shaving/+page.svelte`, not a fourth tab on /automations.

---

## Layout patterns by screen type

Every screen picks one of four shapes, and `routes/(app)/page-shells.test.ts` holds it to the choice
— along with the two shapes that are not screens at all, a nested settings panel and a redirect stub.
The measure is always stated on the tag, even when it matches the default — an unstated width is a
width nobody chose.

### 1. Dashboard screens — `<PageShell width="wide">`

/statistics, /history, /system, /automations, /automations/peak-shaving. Charts and dense readouts
inside stacked `Section` cards. `max-w-7xl`, uncapped again at 2xl.

### 2. Form and list screens — `<PageShell width="narrow">`

/controls. Read line by line, so the measure caps at `max-w-3xl`; two inputs side by side is worse
than stacked at 412px.

### 3. Settings panels — no shell at all

The settings layout supplies the `PageShell` and caps the panel column at the narrow measure beside
its `md:` rail. A panel that grows a shell of its own doubles the gutter and caps the measure twice,
so panels root at their content.

### 4. Bespoke — the overview

`(app)/+page.svelte` is a kiosk grid pinned to the viewport on lg+. The grid, the height and the
overflow all belong on the very element `PageShell` owns, and `PageShell` deliberately takes no
`class` prop — so the overview owns its root and still spends `{SHELL_PAD}`, `{SHELL_GAP}` and the
header-height variable. It is the documented exception, not a precedent: the next page that wants
one has to argue it into that test.

Whatever the shape, page-level controls go in `PageShell`'s `toolbar` snippet and "where I came
from" goes in `lead`; both share one row, so a back link never costs a second one.

---

## Svelte-native animation guidance

Prefer native Svelte motion before custom animation libraries.

### Use `transition:` for enter/exit

Recommended primitives:

- `fade` for subtle appearance/disappearance
- `fly` for small contextual movement
- `slide` for expanding/collapsing sections
- `scale` only for compact overlays or popovers

Good uses in this app:

- the sidebar sheet opening on a phone
- inline alerts and connection-lost banners
- empty states appearing
- a `Section` folding — `SectionBody` already does this, with reduced motion handled
- route content changing inside the stable `(app)` shell

Distance stays small and the duration short: `in:fly={{ y: 8, duration: 180 }}` paired with
`out:fade`, with the `y` dropped to `0` under `prefersReducedMotion.current`.

### Use `animate:flip` for reordering lists

Use this when rows/cards change position because of:

- sorting or filtering an automation list
- a status change reordering entries
- the customize mode on /statistics moving a section

`animate:flip` only moves what it can identify, so the `{#each}` needs a real key — `(item.id)`,
never the index, which renumbers as the list reorders and animates nothing.

### Use `Spring` or `Tween` for value motion

Use `svelte/motion` when the thing that changes is a value, not a DOM mount/unmount.

Good uses, all of them already in the codebase:

- a live reading gliding to its next sample (`AnimatedNumber`)
- the battery SOC bar (`battery-bar.svelte`)
- a chart's live cursor (`_shared/live-cursor.svelte.ts`)

A glide is only honest over a value that is actually arriving at that cadence. Animating a number
the engine decided on 30 seconds ago makes a stale reading look live — see the live-value ownership
rule in `lib/live/ownership.ts`, and `animatable()`, which withholds a stale reading from the glide.

Prefer the modern Svelte 5 classes:

- `Spring`
- `Tween`

Avoid older `spring()` / `tweened()` unless maintaining legacy code.

### Always respect reduced motion

Use `prefersReducedMotion.current` to reduce or remove movement.

This is especially important for:

- route transitions
- sidebar movement
- large panel shifts
- anything that repeats on every poll — a 1 Hz feed animating twice is a flicker

---

## Motion rules for this app

### Good motion

- 120ms to 220ms for most UI transitions
- small distance movement only
- fade + slight fly for local content
- slide for disclosure sections
- flip for reordered lists

### Avoid

- full-page dramatic transitions
- large parallax movement
- delayed content reveal that blocks reading
- bouncing animations on frequently updated content
- animating every panel on every route change

### Specific recommendation

Animate the **inner content**, not the whole shell.

The header/sidebar/breadcrumbs should feel stable. Only the changing content region should move.

---

## Gestures on a chart

Four charts zoom — the /history metric charts, /statistics' period chart, the price track and the
year-over-year bars. The gesture is a design decision with a cost on a phone, not a library
default: `lib/charts/zoom.svelte.ts` holds the state, `lib/charts/zoom-range.ts` holds what a
selection *means*, and `lib/charts/zoom-wiring.test.ts` holds every chart to both.

- **A horizontal drag selects a range; a vertical swipe still scrolls the page.** LayerChart's
  brush layer covers the whole plot and declares `touch-action: none` on itself, and /history and
  /statistics are tall stacks of full-width charts — so that rule breaks the gesture people use
  most with the one they use least. `[&_.lc-brush-context]:touch-pan-y` in
  `ui/chart/chart-container.svelte` hands the vertical axis back to the browser and keeps the
  horizontal one, which is the only axis a selection is drawn on anyway.
- **Pinch is ARMED per chart, never always on.** A live pointer transform sets an inline
  `touch-action: none` *and* calls `preventDefault()` on every touchmove, so an always-on pinch
  would stop the page scrolling on every chart in the stack. The brush is the resting state; pinch
  is something the viewer switches on for one chart (`toggle()`). The two cannot both be live
  anyway — LayerChart wires brushing and panning to the same pointer — so arming pinch disables the
  brush, which is the library's fact and this app's preference at the same time.
- **A zoom REFETCHES at a finer bucket; it never magnifies what was already fetched.** Every mapper
  in `zoom-range.ts` ends at the app's existing range state with the granularity re-derived from the
  selected span, so twenty minutes out of an hourly window comes back as minute rollups, and the
  chart's local transform is reset the moment the owner accepts the range — otherwise the finer data
  would arrive magnified through the old gesture. A selection under `minExtent` is a mis-tap and is
  dropped. Where there is no finer series to fetch the selection narrows the domain in place
  instead: the price track is already quarter-hourly, and the year-over-year comparison *is* its
  twelve months.
- **Every zoomable chart owns a visible way back.** `ZoomControls` sits over the plot rather than in
  a row of its own — these charts are as short as 176px — and its reset button appears the moment
  anything is zoomed, including a zoom the *owner* is holding as a refetched range, which the
  chart's own transform can no longer see. A chart left narrowed with no control does not read as
  zoomed; it reads as wrong numbers.
- **Two charts deliberately do not zoom**, and must stay that way: the custom live chart and the
  automations decision chart. Each already runs a transform of its own inside a `ChartClipPath` — a
  gliding live window, a decision timeline — and a second one composes badly.

## Full screen on a chart

Every chart can take the whole screen, and the control is **in the section card's header**, beside
the title that already names it. Not floating over the plot: that corner is the brush surface these
charts drag-select with, and a button there swallows the start of a drag.

- **`<Section fullscreen>`** is the whole vocabulary for a chart that lives in a card. For a chart
  that has no card — the two dialogs, the forecast-correction panel, the four decision plots —
  wrap the plot in **`<ChartFullscreen title>`**.
- **One control per plot, not per card**, when a card holds more than one. `decision-charts` has two
  plots and three paragraphs; expanding the card split a landscape screen five ways and left each
  plot 59px tall.
- The card is **not replaced by a bigger copy of itself**. Same header, same body, the same chart
  component with its brush and pinch still bound. Only classes change, and they are one token —
  `expandedSectionClass` / `expandedChartClass` in `tokens.ts`.
- Those classes are **written out literally, never composed with `map`/`join`**. Tailwind finds
  classes by scanning source text, so a name this codebase builds at runtime is a name with no rule
  behind it: present in the DOM, silently doing nothing. That exact mistake shipped a full-screen
  card with a 192px chart in it. A test reads the token's source file back and rejects a composed
  name.
- The expansion grows the **whole chain** from the section body down to the plot, picked out with
  `:has([data-slot=chart])`, because the depth differs per chart and a legend beside the plot has to
  keep its content height.
- **What goes full screen is `<html>`, never the card.** This is the load-bearing rule. In native
  full screen the browser renders *only* the full-screen element's subtree, and every popup in this
  app — layerchart's tooltip, and bits-ui's dropdown, select and popover content — is portalled to
  `document.body`, outside any one card. Full-screening the card therefore hid every tooltip and
  left every menu opening invisibly, so the controls read as dead. `fullscreenTarget()` returns the
  document element and there is no way to ask for anything else.
- **The card is lifted by `fixed inset-0`, always** — in both paths, because the browser does nothing
  to lift it. The native call buys exactly one thing on top: the browser's own chrome goes away.
  Losing it (Safari on iPhone implements the API for nothing but `<video>`; under Home Assistant
  ingress the app is a cross-origin iframe Chrome refuses the request in) costs only that, which is
  why `expanded` is set *before* the request and never depends on its outcome.
### Draft charts

A reader can pull a second metric onto a full-screened history card without saving anything —
"compare with…" in the card's header while it is expanded.

- **One renderer.** A draft draws through `OverlayChartView`, the same component a *saved* custom
  chart uses. The only difference between the two is where the key list came from. Two renderers
  would be two things to keep in step, and the mixed-unit dual axis is the kind of thing that only
  works in one of them.
- **The draft is component state on the card**, not a store: it is one reader looking at one chart,
  and a store would make every card share one draft.
- **It dies with the gesture.** Expanding only swaps classes — nothing remounts — so the state
  survives the toggle and the discard has to be written down (`if (!screen.expanded) draft = []`).
- **Say it is temporary.** Everything else on these pages persists, so a chart that will vanish
  says so under the plot, next to the two ways out of it.
- **Saving goes through the editor that already writes custom charts**, seeded — not a second
  create path. That keeps naming, validation and the admin gate in one place.
- The card's own metric is the base: always first (so it keeps chart accent 1 while others come and
  go), and its row in the picker is **disabled**, not silently ignored — a checkbox that does
  nothing when tapped reads as broken.
- A card taken full screen **mounts its chart whether or not the lazy-mount observer fired**. Once
  the card is `fixed`, its in-flow wrapper collapses to nothing, so that observer can never fire
  while it is expanded.

- Known limit: in **portrait** on a phone the plot is still 412px wide, so the 34px narrow gutter
  applies and a two-digit `kWh` label can clip. Landscape — the orientation a full-screen chart is
  actually read in — gets the designed 60px gutter.

---

## Styling and spacing guidance

Everything in this section is a constant in `src/lib/layout/tokens.ts` and a case in
`tokens.test.ts`. Read the numbers here, spend the token in the code — a literal that happens to
match today is a literal that drifts tomorrow.

### The three measures

`SHELL_WIDTH`, named by intent rather than by size, chosen with `<PageShell width="…">`:

| Intent   | Class                    | For                                                     |
| -------- | ------------------------ | ------------------------------------------------------- |
| `narrow` | `max-w-3xl`              | forms, lists, prose — anything read line by line         |
| `wide`   | `max-w-7xl 2xl:max-w-384` | dashboards and charts; uncapped again on very large screens |
| `full`   | `max-w-none`             | bespoke full-bleed layouts (the overview's grid)         |

There is no fourth. Seven pages once shipped four different measures, and /automations
(`max-w-3xl`) sat next to its own detail page (`max-w-7xl`), so the measure jumped mid-navigation.

### Padding and rhythm

| Token         | Value              | What it separates                                   |
| ------------- | ------------------ | --------------------------------------------------- |
| `SHELL_PAD`   | `p-4 sm:p-6`       | page gutter — grows where the gutter is cheap        |
| `SHELL_GAP`   | `gap-6`            | one section from the next                            |
| `SECTION_PAD` | `p-3 sm:p-4`       | section gutter — **steps down on mobile**            |
| `SECTION_GAP` | `gap-4`            | a section's header from its content, block to block  |
| `CLUSTER_GAP` | `gap-x-3 gap-y-2`  | a wrapping row of controls                           |

The shell pads *up* and the section pads *down* because they nest. Shell + section + chart panel is
three boxes deep; three `p-4`s cost 50px per side at 390px, a quarter of the screen spent on chrome.
The outermost box can afford the gutter, the innermost cannot — so `Section nested` drops its border
and its phone pad entirely and takes both back at `sm`.

Those five are the whole rhythm. `gap-8` and `gap-2` between sections are not options.

### Grids

`GRID` in the tokens, `<SectionGrid variant="…">` in markup:

| Variant | Ramp                                         | For                                    |
| ------- | -------------------------------------------- | -------------------------------------- |
| `tiles` | `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`  | dense readouts: stat tiles, metric pairs |
| `pair`  | `grid-cols-1 lg:grid-cols-2`                 | two charts, side by side once there is room |
| `wall`  | `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`  | many cards of equal weight              |

Every variant states a **base** column count and carries `[&>*]:min-w-0`. `grid sm:grid-cols-2` is
not "two columns from sm up, one below" — below `sm` the utility simply does not apply and the grid
falls back to its implicit single column, which nobody decided. That omission is what stacked 31
statistics tiles one-up on a phone; the missing `min-w-0` is what let one long kWh total widen its
column past the viewport.

### Breakpoints

**`sm` / `lg` / `xl` / `2xl` only.** A token that changes twice between a phone and a laptop
produces the in-between states nobody designed, so `tokens.test.ts` fails on any `md:` in the
vocabulary.

The one grandfathered `md:` in first-party layout code is the settings nav rail
(`settings/+layout.svelte`, `settings-nav.svelte`): a 13rem rail plus a usable panel does not fit
below 768px, and no `sm`/`lg` pair lands the rail in the same place. The file says so in a comment,
and the census test checks that it still does. Vendored shadcn components under
`lib/components/ui/` carry upstream `md:` utilities; leave them alone.

### Borders and surfaces

One frame: `border border-border`, square, drawn by `Section` and nothing else. Hierarchy comes from
spacing and typography, not from stacked outlines — which is why a card inside a card gives up its
frame on a phone. An element outside `lib/components/layout/` that combines `border border-border`
with a pad is a hand-rolled card, and `section-migration.test.ts` treats it as one.

---

## Typography and readability

This app is read at a glance and in a hurry — often on a phone, in a plant room. Numbers carry the
meaning; the type around them exists to say which number this is.

- **Section title:** `text-sm font-medium uppercase tracking-wide text-muted-foreground`, drawn by
  `SectionHeader` and nowhere else. The optional caption under it is `text-xs`.
- **Readouts:** the value is the loud element; its label is muted and small, never smaller than the
  floor below.
- **Never below `text-xs` (12px) on a phone.** A stat tile's uppercase tracked label is its only
  identification, and `text-[0.65rem]` is 10.4px. Where the desktop scale goes tighter it does so
  from `sm` up: `text-xs sm:text-[0.65rem]`.
- **A label that does not fit wraps; it does not truncate.** `truncate` on a phone loses the end of
  the word that identified the thing — "Netzeinspeisegrenze" became "Netzeinspei…". German is the
  long language here, so check the German string, not the English one. `SectionHeader` truncates
  its title on desktop only and takes it back with `max-sm:whitespace-normal`.

---

## Responsive strategy

The app is designed at 412x961 first. Everything below is a floor, enforced by
`lib/layout/mobile-density.test.ts` over the whole `src` tree — so a rule broken in a component
written next year fails too.

### Mobile floors

- **Every grid states its phone column count.** Readouts go two-up, not one-up; a form is allowed to
  stack, but it has to say so.
- **44px touch targets.** Interactive sizes gain a step below `sm` and hand it back at `sm`
  (`h-9 sm:h-8`, `size-9 sm:size-8`, calendar cells `--cell-size` 9 then 7). An icon-only trigger
  has no label to widen its hit area, so it spends `TAP` — an invisible `::after` that reaches
  44x44 around a 16px icon without moving the icon. `tapTargetPx()` measures that from the token
  rather than restating it.
- **Chart plot boxes are `CHART_BOX` (`h-48 sm:h-64`)**, or `CHART_BOX_SHORT` (`h-44 sm:h-55`) where
  a chart ships shorter by design. Header + plot + legend at `h-64` is ~340px, so a 961px phone
  fitted two and a half charts and /statistics measured 7371px end to end. An empty or loading state
  uses the same box, or the page jumps by the difference when data lands.
- **Chart gutters follow the measured plot width**, not a breakpoint: the same component renders
  full-bleed on /history and two-up inside a statistics section. Bind `clientWidth` and pass *that
  variable* to `chartPaddingFor` / `xTickSpacingFor` / `stackedBarProps`. The rule is over the whole
  tree, not over the charts that had the bug — the callers are discovered from disk, so a component
  that does not exist yet is already covered, and writing the gutter out longhand as
  `padding={{ left: 60 }}` fails the same way. The charts outside the cost/statistics family carry
  hand-tuned gutters of their own; each is listed by name with the left value it actually writes, so
  that set cannot grow and no chart can be moved onto another family's padding unnoticed.
- **Nothing scrolls sideways.** `<main>` clips horizontal overflow, grid children carry `min-w-0`,
  and a popover caps itself at `max-w-(--bits-popover-content-available-width)`.
- **Reading order is a decision.** Stacked, a two-column page reads top to bottom in source order —
  which put peak shaving's configuration form between the reader and the live status it configures.
  `order-*` with an `xl:order-*` pair fixes the phone order without moving the desktop columns.

### Desktop

- the sidebar is permanent (icon-collapsed at most); on a phone it becomes the sheet the trigger
  opens
- multi-column layouts only where comparison actually helps — `GRID.pair` starts at `lg`
- a control row that would cramp wraps (`flex-wrap` plus `CLUSTER_GAP`); past three options a
  segmented switcher offers a `Select` on a phone instead of wrapping to a second line that reads
  as an unrelated control

---

## Loading and empty states

Both are layout, and both are where the page jumps if you improvise them.

### Skeletons when the layout is known

A readout that will arrive renders a `Skeleton` of its eventual size — see
`inverter/_shared/chart-state-view.svelte`, `kpi-slot-row.svelte`, `energy-headline.svelte`. A chart
placeholder is the same `CHART_BOX` as the plot it replaces.

### Spinners only for small indeterminate actions

Button-level submit states, retries, a short background refresh. Never a spinner where the shape of
the result is already known.

### Empty states are `EmptyState`, and they are actionable

`lib/components/layout/empty-state.svelte` — a message, an optional icon, an optional recovery
action. `min-h-32` is a floor rather than a fixed height: a fixed 160px reserves a fifth of a phone
screen to say nothing, and clips a two-line message that carries a button.

Say why the screen is empty and what to do next. "No data." is not an empty state; "No readings yet
— the inverter has not been polled since 14:02" is. The copy goes through paraglide like every other
user-visible string.

`section-migration.test.ts` fails on a re-copy of the old hand-rolled empty-state block.

---

## Final rule of thumb

- **Layouts** own persistent chrome.
- **Routes** own meaningful screen state.
- **Tabs** present two renderings of one thing; anything worth a URL is a subroute.
- **Tokens and the layout primitives** own measure, gutter, rhythm, columns and chart heights. If
  you are typing one of those as a literal, you are adding the sixth variant of something that
  already exists.
- **Animations** should guide attention, never compete with the content.

The design decisions above are executable: `lib/layout/tokens.test.ts`,
`lib/layout/mobile-density.test.ts`, `lib/layout/section-migration.test.ts`,
`lib/layout/primitives.test.ts`, `lib/components/layout/header-and-toolbar-rows.test.ts`,
`routes/(app)/page-shells.test.ts`, `lib/live/wiring.test.ts` and `lib/charts/zoom-wiring.test.ts`
run in `bun run test`. Read the
`layout-system` skill before writing a page; read the failing test when one of them rejects you.
