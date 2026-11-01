---
name: layerchart
description: Build and fix charts with LayerChart v2 (Svelte 5 + D3 composable charting). Use for any chart, graph, sparkline, heatmap, map, sankey, treemap, tooltip/legend/axis/brush/zoom work in Svelte, for `import ... from 'layerchart'`, for shadcn-svelte `Chart.*` components (built on LayerChart), and for fetching LayerChart docs via its `/llms.txt` endpoints. Triggers on "layerchart", "LineChart", "BarChart", "AreaChart", "PieChart", "ScatterChart", "add a chart", "dashboard chart", "tooltip on chart", "d3 in svelte".
user-invocable: false
allowed-tools: Bash(curl -sL https://www.layerchart.com/*), Bash(bun add layerchart*), Bash(bunx --bun shadcn-svelte@latest add*), Bash(bun x shadcn-svelte@latest add*)
---

# LayerChart

Composable Svelte 5 charting library on top of d3-scale / d3-shape. `<Chart>` owns data, scales,
dimensions and interactive state; marks (`Spline`, `Bars`, `Area`, `Points`, `Arc`, ...) read that
state and draw into a `<Layer>` (`svg` | `canvas` | `html`). Simplified charts (`LineChart`,
`BarChart`, `AreaChart`, `ScatterChart`, `PieChart`, `ArcChart`) are pre-wired `<Chart>`s.

**Version matters.** Target **v2** (`layerchart@^2`, Svelte 5 runes, snippets, camelCase style
props, `tooltipContext`). Most training data is v1 (Svelte 4, slots, `tooltip=`, `fill-opacity`,
`getBarsProps`). When in doubt, verify against live docs (below) and see
[references/migration-v1-v2.md](./references/migration-v1-v2.md).

## 1. Fetch live docs first (llms.txt)

LayerChart ships LLM-friendly markdown for every page. Always pull the exact page before writing
non-trivial code — component props change between minors.

| Need | URL |
| --- | --- |
| Index of all pages | `https://www.layerchart.com/llms.txt` |
| Everything in one file (~340 KB) | `https://www.layerchart.com/docs/llms.txt` |
| One component | `https://www.layerchart.com/docs/components/<Name>/llms.txt` |
| One guide | `https://www.layerchart.com/docs/guides/<slug>/llms.txt` |
| Getting started | `https://www.layerchart.com/docs/getting-started/llms.txt` |
| Utility | `https://www.layerchart.com/docs/utils/<name>/llms.txt` |

```bash
# component API + examples list
curl -sL https://www.layerchart.com/docs/components/BarChart/llms.txt
# guide
curl -sL https://www.layerchart.com/docs/guides/tooltip/llms.txt
```

Component pages contain: description, supported layers, usage code, full **API table**
(prop / type / default), example slugs. Example source is at
`/docs/components/<Name>/<example-slug>` (HTML page, not llms.txt). Full name list and guide slugs:
[references/docs-index.md](./references/docs-index.md).

## 2. Install

```bash
bun add layerchart            # peer: svelte ^5
```

Sub-path exports (NOT re-exported from root, keeps bundle small):

```ts
import { Tree, Treemap, Pack, Partition } from 'layerchart/hierarchy';
import { GeoPath, GeoProjection, Graticule, GeoTile } from 'layerchart/geo';
import { ForceSimulation } from 'layerchart/force';
import { Sankey, Dagre, Chord, Ribbon } from 'layerchart/graph';
// optional layer-locked variants (~25% smaller, faster mount):
import { Circle, Rect } from 'layerchart/svg'; // or /canvas, /html
```

### CSS (required or chart is invisible / wrong colors)

LayerChart defaults to `currentColor`. Provide theme vars once in `app.css`:

```css
/* pick ONE: framework preset ... */
@import 'layerchart/shadcn-svelte.css';   /* shadcn-svelte (this repo) */
/* @import 'layerchart/skeleton-5.css'; @import 'layerchart/daisyui-5.css'; */

/* ... or manual vars */
.lc-root-container {
	--color-primary: var(--color-blue-500);
	--color-surface-100: var(--color-white);
	--color-surface-200: var(--color-gray-100);
	--color-surface-300: var(--color-gray-300);
	--color-surface-content: var(--color-gray-900);
}
.dark .lc-root-container { /* override same vars */ }
```

Without Tailwind or a preset also add `@import 'layerchart/core.css';` (declares
`@layer theme, base, components, utilities` order; missing → styles flip in prod builds).

### In this repo (apps/web, shadcn-svelte + Tailwind v4)

Preferred path: install the shadcn-svelte `chart` wrapper, which pins theming + tooltip styling.

```bash
cd apps/web && bun x shadcn-svelte@latest add -y -o chart
```

```svelte
<script lang="ts">
	import * as Chart from '$lib/components/ui/chart/index.js';
	import { BarChart } from 'layerchart';
	const chartConfig = {
		desktop: { label: 'Desktop', color: 'var(--chart-1)' },
		mobile: { label: 'Mobile', color: 'var(--chart-2)' }
	} satisfies Chart.ChartConfig;
</script>

<Chart.Container config={chartConfig} class="min-h-[200px] w-full">
	<BarChart
		{data}
		x="month"
		axis="x"
		seriesLayout="group"
		series={[
			{ key: 'desktop', label: chartConfig.desktop.label, color: chartConfig.desktop.color },
			{ key: 'mobile', label: chartConfig.mobile.label, color: chartConfig.mobile.color }
		]}
		props={{ xAxis: { format: (d) => d.slice(0, 3) } }}
	>
		{#snippet tooltip()}
			<Chart.Tooltip />
		{/snippet}
	</BarChart>
</Chart.Container>
```

`Chart.Container` exposes each config key as `var(--color-<key>)`. Chart colors come from
`--chart-1..5` in `app.css`. `Chart.Tooltip` props: `labelKey`, `nameKey`, `indicator`
(`dot|line|dashed`), `hideLabel`, `hideIndicator`, `labelFormatter`, `formatter` snippet.
shadcn does **not** wrap LayerChart — everything below still applies inside `Chart.Container`.

## 3. Core mental model

### Accessors → scales → marks

```svelte
<Chart {data} x="date" y="value" c="category" r="size" />
```

| Channel | Scale | Auto type by data |
| --- | --- | --- |
| `x`, `y` | `xScale`, `yScale` | `Date` → `scaleTime`, number → `scaleLinear`, string → `scaleBand` |
| `c` | `cScale` (color) | ordinal → `scaleOrdinal`; override with `cRange`/`cScale` |
| `r` | `rScale` (radius) | sqrt-ish, bubble charts |
| `z` | `zScale` | grouping / secondary |
| `x1`, `y1` | sub-band within band | grouped bars (`seriesLayout="group"`) |
| `fx`, `fy` | facet panels | small multiples, shared scales |

Accessor forms: `"prop"`, `(d) => d.prop`, or array `['min','max']` (interval / multi-domain).
Per-channel overrides: `xDomain={[0, null]}` (null = auto), `yNice`, `xPadding`, `yBaseline={0}`,
`xScale={scaleLog()}`, `xRange`, `cRange={[...]}`, `xReverse`, `xInterval={timeDay}`.

### Render layout and snippets (all receive `{ context }`)

```
belowContext (HTML under chart)
└─ Layer
   ├─ belowMarks   reference lines, shading
   ├─ marks        YOUR data marks
   └─ aboveMarks   labels, overlays
aboveContext (HTML over chart)
```

`children` snippet **replaces everything** (no axis/grid/tooltip unless you add them). Prefer
`marks` to keep built-ins.

### Built-in features on `<Chart>` and simplified charts

| Prop | Default | Forms accepted |
| --- | --- | --- |
| `axis` | true | `true`/`false`/`"x"`/`"y"`/props obj/snippet |
| `grid` | true | `{ x: false }`, props, snippet |
| `rule` | true | zero line on value axis |
| `highlight` | true | `{ lines, points, area, bar, axis }` |
| `points`, `labels`, `legend` | false | bool / props / snippet |
| `tooltipContext` | false (simplified charts auto-enable) | `{ mode, ... }` / `false` |
| `brush`, `transform` | off | see interactions ref |

Tune internals without replacing them via `props`:

```svelte
<LineChart {data} x="date" y="value"
	props={{
		xAxis: { format: 'day', ticks: 5 },
		yAxis: { format: 'metric' },
		grid: { strokeDasharray: '4 2' },
		spline: { curve: curveCatmullRom },   /* bars / area / points likewise */
		tooltip: { header: { format: 'day' }, item: { format: 'currency' }, hideTotal: true },
		highlight: { points: { r: 5 } }
	}} />
```

Chart-level `props.<mark>` are **ignored** when you supply a custom `marks` snippet — put them on
the mark or in `series[].props`.

### Simplified chart vs `<Chart>`

Use `LineChart`/`BarChart`/... for standard charts. Drop to `<Chart>` when mixing mark types,
controlling render order, or doing radial / hierarchy / geo / graph layouts. Escape hatch: any
simplified chart accepts the same snippets (`marks`, `legend`, `tooltip`, `axis`, ...).

```svelte
<LineChart {data} x="date" series={[{ key: 'a' }, { key: 'b' }]} legend>
	{#snippet marks({ context })}
		{#each context.series.visibleSeries as s (s.key)}
			<Spline seriesKey={s.key} curve={curveCatmullRom} />
		{/each}
	{/snippet}
</LineChart>
```

Full composed chart:

```svelte
<script lang="ts">
	import { Chart, Layer, Axis, Bars, Spline, Highlight, Legend, Tooltip } from 'layerchart';
</script>

<Chart {data} x="month" series={[{ key: 'apples' }, { key: 'bananas' }]}
	yNice bandPadding={0.3} padding={{ left: 40, bottom: 24, top: 8, right: 8 }}
	tooltipContext={{ mode: 'band' }} height={300}>
	{#snippet children({ context })}
		<Layer>
			<Axis placement="left" grid rule format="metric" />
			<Axis placement="bottom" rule />
			{#each context.series.visibleSeries as s (s.key)}
				<Bars seriesKey={s.key} radius={2} rounded="edge" />
			{/each}
			<Spline y="target" class="stroke-2 [stroke-dasharray:4_3]" />
			<Highlight area />
		</Layer>
		<Legend placement="top-right" />
		<Tooltip.Root>
			{#snippet children({ data })}
				<Tooltip.Header>{data.month}</Tooltip.Header>
				<Tooltip.List>
					{#each context.series.visibleSeries as s (s.key)}
						<Tooltip.Item label={s.key} value={data[s.key]} color={s.color} format="integer" />
					{/each}
				</Tooltip.List>
			{/snippet}
		</Tooltip.Root>
	{/snippet}
</Chart>
```

### Sizing

`<Chart>` fills its container width; give `height={300}` or a sized parent
(`class="h-[300px]"`). Padding: `padding={24}` or `{ top, right, bottom, left }`;
`defaultChartPadding({ left: 40, legend: true })` helper.

## 4. Data shapes — pick before coding

| Shape | Example row | Use |
| --- | --- | --- |
| Single series | `{ date, value }` | `x="date" y="value"` |
| **Wide** (column per series) | `{ date, apples, bananas }` | `series={[{ key:'apples' }, { key:'bananas' }]}` |
| **Long / tidy** (category column) | `{ year, fruit, value }` | `x="year" y="value" c="fruit"` — no `series`, no pivot |
| Per-series arrays | `applesData[]`, `bananasData[]` | `series={[{ key, data, color }]}` + chart `y="value"` |
| Interval | `{ start, end }` | `x={['start','end']}` → duration bars, never stacked |
| Hierarchy / graph | `HierarchyNode`, `SankeyGraph` | `data={root} flatData={leaves}` |

`seriesLayout`: `auto` (default; stacks when ≥2 series or ordinal `c`, except lines/points/intervals)
| `overlap` | `stack` | `stackExpand` (100%) | `stackDiverging` | `group` (bars only, needs `x1`
for long data). Series def fields: `key` (required), `label`, `value`, `data`, `color`,
`selected:false` (start hidden), `props`, `maxValue`. Details:
[references/series-data.md](./references/series-data.md).

## 5. Tooltip modes — choose by chart type

| Chart | `tooltipContext.mode` |
| --- | --- |
| Line / area (time or numeric x) | `quadtree-x` (default, unsorted ok) or `bisect-x` (sorted) |
| Bars / categorical | `band` (default for BarChart) or `bisect-band` |
| Scatter / bubble | `quadtree` (default) or `voronoi`; add `radius: 50` |
| Duration / overlapping ranges | `bounds` |
| Pie / arc / geo / custom shapes | `manual` + `<Pie tooltip />` / `<GeoPath tooltip />` or `context.tooltip.show(e, d)` |
| Facets | `facet` |

`Tooltip.Root` positioning: `x="data" y={0}` (fixed top), `anchor="bottom-right"`,
`variant="invert"`, `motion={false}`, `portal={false}`, `contained="window"`. Interactive
content: `tooltipContext={{ locked: true, hideDelay: 300 }}` + `<Tooltip.Root pointerEvents>`.
Debug hit areas: `tooltipContext={{ mode, debug: true }}`. Full ref:
[references/tooltip.md](./references/tooltip.md).

## 6. Styling rules

- Colors: `class="stroke-primary fill-primary/20"` (works in **Canvas** too), `fill="var(--chart-1)"`,
  or data-driven `fill={(d) => d.v > 0 ? 'var(--color-ok)' : 'var(--color-bad)'}`,
  `fill="category"` (resolves via `cScale` when the string is a data key).
- Style props are **camelCase**: `fillOpacity`, `strokeWidth`, `strokeDasharray` — not `fill-opacity`.
- Nested element classes: `<Axis classes={{ rule: '...', tickLabel: '...' }} />`,
  `<Legend classes={{ item, swatch, label }} />`, `<Tooltip.Root classes={{ root, content }} />`.
- Every component has an `lc-*` class (`.lc-axis`, `.lc-spline`, `.lc-rect`) with zero specificity
  (`:where()`), so plain CSS overrides win without `!important`.
- Dark mode: Tailwind `dark:` variants on marks, or override `.dark .lc-root-container { --color-* }`.
- Color schemes: `cRange={schemeTableau10}` (d3-scale-chromatic), `cScale={scaleThreshold()}` /
  `scaleQuantize()` for thresholds & heatmaps, `scaleSequential(interpolateViridis)` + `<Legend>`.
- Gradients: `<LinearGradient>{#snippet children({ gradient })}<Area fill={gradient} />{/snippet}</LinearGradient>`.
  More: [references/styling.md](./references/styling.md).

## 7. Layers, primitives, performance

- `Svg` default; `Canvas` for >~5k marks (`<LineChart layer="canvas">` or `<Layer type="canvas">`),
  still supports classes, CSS vars, pointer events; `Html` for rich text/legends/layout.
  Mix layers in one chart. Global default: `setSettings({ layer: 'canvas' })` in a root layout.
- Primitives (`Circle`, `Rect`, `Line`, `Text`, `Group`, `Image`, `Polygon`, `Ellipse`) have
  **data mode**: `<Circle cx="date" cy="value" r={5} />` renders one per row through scales. Number
  → pixel, string/function → data. `data={...}` prop overrides chart data.
- Native `<rect>` etc. inside `<Svg>` is ~6× cheaper to mount but loses motion, registration, canvas.
- Chart-level `data`/`x`/`y`/`series` = single render pass. Per-mark `y="..."`/`data` register
  after first render (two passes). Prefer chart-level for big data.
- Motion: `motion="spring" | "tween" | "none" | { type, duration, easing, stiffness }` on marks,
  `<Chart motion>` for scales, `draw` on Spline for path draw-in. Set `motion={false}` in tests/SSR.

## 8. State access

```svelte
<script lang="ts">
	import { getChartContext, type ChartState } from 'layerchart';
	const ctx = getChartContext(); // inside chart tree: ctx.xScale, ctx.yGet(d), ctx.tooltip.data, ctx.series.visibleSeries
	let context = $state<ChartState>(null!); // outside via <Chart bind:context>
</script>
```

Sub-states: `context.tooltip` (`data`, `series`, `show`, `hide`), `context.series`
(`visibleSeries`, `selectedKeys.toggle(key)`, `highlightKey`, `isVisible`), `context.brush`
(`x`, `y`, `active`, `reset`, `move`), `context.transform` (`zoomIn`, `zoomOut`, `reset`),
`context.geo.projection`. Dimensions: `width`, `height` (inner), `containerWidth`, `padding`.

Interactions (brush, pan/zoom, ChartGroup sync, facets, annotations):
[references/interactions.md](./references/interactions.md).

## 9. Gotchas checklist

- [ ] `layerchart@^2` + Svelte 5; snippets not slots; `tooltipContext=` not `tooltip=` on `<Chart>`.
- [ ] Theme CSS imported (`layerchart/shadcn-svelte.css` or `.lc-root-container` vars) — else
      invisible / currentColor marks.
- [ ] Explicit `height` or sized parent.
- [ ] `yDomain={[0, null]}` or `yBaseline={0}` for bars/areas that must start at zero.
- [ ] `bisect-x` requires sorted x; `scalePoint`/`scaleBand` take domain in data order → sort first.
- [ ] Stacking with shared data on raw `<Chart>`: give each series a `value` and do **not** also set
      array `y` (produces zero-height bars). `BarChart` handles this.
- [ ] Long data grouped bars need BOTH `x1="cat"` and `seriesLayout="group"`.
- [ ] Custom `marks` snippet disables `props.spline/bars/...` — move props onto the mark.
- [ ] `PieChart` uses `key`/`value`/`label` accessors (not `x`/`y`); `innerRadius={-40}` = offset,
      `0<r<1` = percent, `>=1` = px.
- [ ] Tooltip portals to `document.body` by default; `portal={false}` if positioned wrong in a
      transformed parent.
- [ ] Heavy components import from `layerchart/geo|hierarchy|force|graph`, not root.
- [ ] Svelte MCP `svelte-autofixer` on finished `.svelte` files (repo rule).
- [ ] Run `bun run check` / lint in `apps/web` before commit.

## References

- [docs-index.md](./references/docs-index.md) — all component/guide/util slugs + llms.txt URL scheme
- [series-data.md](./references/series-data.md) — data shapes, series API, layouts, legend toggling
- [tooltip.md](./references/tooltip.md) — modes, positioning, default tooltip customization, manual mode
- [styling.md](./references/styling.md) — CSS vars, presets, classes/props patterns, color scales, SSR
- [interactions.md](./references/interactions.md) — brush, transform, ChartGroup, facets, annotations, animation
- [migration-v1-v2.md](./references/migration-v1-v2.md) — v1 → v2 find/replace (fix stale training data)
