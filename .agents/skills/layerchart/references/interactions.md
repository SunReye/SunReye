# Interactions: brush, pan/zoom, sync, facets, annotations, animation

## Brush (selection)

```svelte
<Chart {data} x="date" y="value" brush />                                 <!-- visual only -->
<Chart brush={{ axis: 'x'|'y'|'both', x: xDomain, onChange: (e) => ..., onBrushEnd: (e) => ..., clickToReset: true, classes: { range, handle } }} />
```

Events receive `{ brush }` with `brush.x`, `brush.y` (domain units), `brush.active`,
`brush.reset()`, `brush.selectAll()`, `brush.move()`, `brush.contains(d)`.

Common patterns:
- **Brush-to-zoom on simplified chart:** `<LineChart {data} x y brush />` (built-in `zoomOnBrush`).
- **Overview + detail (minimap):** overview chart `brush={{ x: xDomain, onChange: (e) => xDomain = e.brush.x }}`; main chart `xDomain={xDomain}`.
- **Point selection:** `brush={{ axis: 'both', onChange: (e) => selected = data.filter(e.brush.contains) }}`.
- **Categorical (band scale):** `BarChart/brush-band`.
- Custom brush component: `<BrushContext bind:state>`.

## Transform (pan & zoom)

```svelte
<LineChart {data} x="date" y="value" transform={{ mode: 'domain', axis: 'x', scaleExtent: [1, 20],
	domainExtent: { x: { min: 'data', max: 'data', minRange: 7 * 86400000 } }, motion: 'spring',
	scrollMode: 'scale'|'translate'|'none', scrollActivationKey: 'meta', inertia: true, pinch: true, disablePointer: false }} />
```

| Mode | Effect | For |
| --- | --- | --- |
| `domain` | narrows x/y domain; axes update | cartesian charts, band scales too |
| `canvas` | CSS/SVG transform | maps, images, pack/tree |
| `projection` | mutates geo projection | globes, geo maps |

Programmatic: `context.transform.zoomIn()`, `.zoomOut()`, `.reset()`, `.zoomTo(...)`,
`context.transform.scale/translate`. Combine with brush: `brush` + `transform={{ mode: 'domain' }}`.
Dynamic data loading: derive fetch range from `context.xDomain`. Events: `onTransform`,
`ondragstart`, `ondragend`. Persist zoom: `initialDomain={{ x: saved }}`.

## ChartGroup (sync hover / brush / zoom across charts)

```svelte
<ChartGroup>
	<LineChart id="requests" data={requests} x="date" y="value" height={100} />
	<LineChart id="latency"  data={latency}  x="date" y="value" height={100} />
</ChartGroup>
```

Charts need not share data; each resolves nearest point to the shared domain value.
`context.tooltip.source` / `context.series.highlightSource` tell which chart drives.
Per-chart `groupOptions` picks which slices publish/subscribe. Series visibility & highlight also
sync → one legend drives a dashboard.

**Facets vs group:** same measure split by category → facet (`fx`/`fy`, shared scales, one
chart). Different measures on shared x → `ChartGroup`. They compose.

## Facets (small multiples)

```svelte
<Chart {data} x="bill_length_mm" y="body_mass_g" fx="species" fy="sex" grid
	facet={{ /* spacing, wrap, ... */ }} fxDomain={['Adelie', 'Gentoo']}>
	{#snippet marks()}<Circle cx="bill_length_mm" cy="body_mass_g" r={2.5} />{/snippet}
</Chart>
```

Panels draw own rows, scales computed across all. Tooltip `mode: 'facet'`; `<Axis facetAll>`,
`<Highlight facetAll>`, `<Tooltip.Root facetAll>` per-panel variants. Examples: `Chart/facet-*`,
`BarChart/facet-stack-long-data`.

## Annotations

```svelte
<AnnotationLine y={100} label="Target" labelXOffset={4} class="[stroke-dasharray:4_2]" />
<AnnotationPoint x={date} y={value} label="Launch" seriesKey="apples" props={{ circle: { r: 4 }, label: {...} }} />
<AnnotationRange x={[start, end]} label="Outage" class="fill-red-500/10" />
```

Use in `belowMarks` (under data) or `aboveMarks`. `seriesKey` ties visibility to series
highlight. Static `<Rule x={v} />` / `<Rule y={['start','end']} />` for plain reference lines.
Data-driven `<Labels>` (`placement`, `offset`, `format`, `seriesKey`).

## Animation (`motion`)

```svelte
<Bars motion="spring" />
<Spline motion={{ type: 'tween', duration: 300, easing: cubicInOut }} draw />
<Bars motion={{ y: 'spring', width: 'tween' }} />                     <!-- per property -->
<Chart motion="spring">                                                <!-- animate scales -->
<Tooltip.Root motion={false} /> <Highlight motion={false} />          <!-- disable -->
```

Types: `spring` (`stiffness`, `damping`), `tween` (`duration`, `easing`, `delay`), `none`/`false`.
Stagger: `motion={{ y: { type: 'tween', delay: i * 30 } }}`. Disable everywhere for tests/SSR.

## Click handlers

Simplified charts: `onPointClick` (Line/Area), `onBarClick` (Bar), `onArcClick` (Pie).
`tooltipContext={{ onclick: (e, { data }) => ... }}`. Marks/primitives accept `onclick`,
`onpointerenter`, etc. (also on Canvas via hit canvas). `Legend onclick={(e, item) => ...}`.
