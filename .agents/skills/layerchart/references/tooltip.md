# Tooltip & Highlight

Two halves: **`tooltipContext`** on `<Chart>` (pointer tracking + data lookup) and **`Tooltip.*`**
display components (plain HTML, portaled). `Highlight` reads the same state to draw crosshairs.

```svelte
<Chart {data} x="date" y="value" tooltipContext={{ mode: 'bisect-x' }}>
	<Layer>
		<Area />
		<Highlight points lines />
	</Layer>
	<Tooltip.Root>
		{#snippet children({ data })}
			<Tooltip.Header value={data.date} format="day" />
			<Tooltip.List>
				<Tooltip.Item label="value" value={data.value} format="integer" />
			</Tooltip.List>
		{/snippet}
	</Tooltip.Root>
</Chart>
```

Simplified charts render a `DefaultTooltip` automatically (enabled by default; pass
`tooltipContext={false}` to disable).

## Modes

| Mode | Lookup | Use |
| --- | --- | --- |
| `bisect-x` / `bisect-y` | binary search (sorted data) | time series line/area; `findTooltipData: 'left'|'right'|'closest'` |
| `quadtree-x` / `quadtree-y` | spatial, axis-locked | line/area (LineChart/AreaChart default), unsorted ok |
| `band` | full band hit rect | bars, categorical (BarChart default) |
| `bisect-band` | bisect + band | bars on sorted time axis |
| `facet` | whole panel | few bars per facet panel |
| `bounds` | element bounding boxes | duration bars, overlapping ranges |
| `voronoi` | Voronoi cells | scatter, irregular |
| `quadtree` | nearest in 2D (ScatterChart default) | scatter / geo points; `radius: 50` px limit |
| `manual` | you call `show`/`hide` | pie, arc, geo, custom shapes |

Options: `radius`, `findTooltipData`, `locked`, `hideDelay` (ms), `touchEvents`
(`pan-y` default), `debug: true` (draw hit areas), `raiseTarget: true`,
`onclick: (e, { data }) => ...`.

## Manual mode

```svelte
<Chart tooltipContext={{ mode: 'manual' }}>
	<Pie {data} tooltip />       <!-- Arc, Bar, Pie, GeoPath, Ribbon, Calendar have `tooltip` boolean -->
	<!-- or -->
	<GeoPath geojson={f} onpointerenter={(e) => context.tooltip.show(e, f.properties)} onpointerleave={(e) => context.tooltip.hide(e)} />
	<Tooltip.Root>{#snippet children({ data })}...{/snippet}</Tooltip.Root>
</Chart>
```

## `Tooltip.Root` props

| Prop | Values | Default |
| --- | --- | --- |
| `x`, `y` | `'pointer'` \| `'data'` \| number(px) | pointer |
| `xOffset`, `yOffset` | px | 10 pointer / 0 data |
| `anchor` | `'top-left'`, `'bottom-right'`, `'top'`, ... | top-left |
| `variant` | `'default'` (dark) \| `'invert'` \| `'none'` | default |
| `motion` | `'spring'` \| `{ type:'tween', duration }` \| `false` | spring |
| `portal` | `true` (body / `.PortalTarget`) \| `false` \| `{ target }` | true |
| `contained` | `'container'` \| `'window'` \| `false` | container |
| `pointerEvents` | bool (needed for clickable content with `locked`) | false |
| `fadeDuration` | ms | 100 |
| `classes` | `{ root, container, content, header }` | |
| `data`, `facetAll` | override row / one tooltip per facet panel | |
| `context` | pass chart context for typed `data` | |

Fixed to top, tracking x: `<Tooltip.Root x="data" y={0}>`. Multiple roots allowed (e.g. one per axis).

## Display parts

- `Tooltip.Header` — `value`, `format`, `color`, or children.
- `Tooltip.List` — grid of items.
- `Tooltip.Item` — `label`, `value`, `format` (`'integer'|'decimal'|'currency'|'percent'|'metric'|'day'|'month'|...` or `FormatConfig`), `color` (dot), `valueAlign`.
- `Tooltip.Separator`.

Series-aware snippet receives `{ data, series }`:

```svelte
{#snippet children({ data, series })}
	<Tooltip.Header value={data.date} format="day" />
	<Tooltip.List>
		{#each series as s}<Tooltip.Item label={s.label} value={s.value} color={s.color} />{/each}
	</Tooltip.List>
{/snippet}
```

## Default tooltip on simplified charts

Tweak without replacing via `props.tooltip`:

```svelte
props={{ tooltip: {
	context: { mode: 'bisect-x' },
	root: { variant: 'invert', x: 'data', y: 0 },
	header: { format: 'day' },
	item: { format: 'currency', valueAlign: 'right' },
	hideTotal: true
} }}
```

Replace fully with the `tooltip` snippet (this is where shadcn's `<Chart.Tooltip />` goes):

```svelte
<LineChart ...>
	{#snippet tooltip()}
		<Tooltip.Root>{#snippet children({ data })}...{/snippet}</Tooltip.Root>
	{/snippet}
</LineChart>
```

## Tooltip state (`context.tooltip`)

`data`, `x`, `y`, `series: { key, label, value, color }[]`, `isHoveringTooltipArea`,
`isHoveringTooltipContent`, `show(event, data)`, `hide(event?)`. External read:
`<Chart bind:context>` then `context?.tooltip.data`.

## Highlight

Prop on charts: `highlight={{ lines: true, points: true, area: false, bar: false, axis: 'x'|'y'|'both'|'none', r: true }}`.
Each of `lines`/`points`/`area`/`bar` accepts `true`, component props (`{ class: 'stroke-red-500' }`)
or a snippet. Multi-series → one point per visible series in its color. `motion={false}` to
disable spring. `data={item}` to pin a highlight (annotation). Events: `onPointClick`,
`onAreaClick`, `onBarClick`. Render `<Highlight>` inside the `Layer`, after marks (or in
`belowMarks` for bar-background highlight).
