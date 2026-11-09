# v1 → v2 quick fixes (training data is mostly v1)

LayerChart v2 = Svelte 5 (runes + snippets), Tailwind v4 optional, LayerCake removed, CSS-only
styling. If generated code contains any "Before" form, rewrite it.

| Before (v1 / @next) | After (v2) | Scope |
| --- | --- | --- |
| `<Chart tooltip={{ mode }}>` | `<Chart tooltipContext={{ mode }}>` | Chart |
| `<slot>` / `let:` | `{#snippet children({ context })}` / `marks` / `tooltip` snippets | all |
| `{#snippet marks({ visibleSeries, getBarsProps })}` + `<Bars {...getBarsProps(s, i)} />` | `{#snippet marks({ context })}` + `<Bars seriesKey={s.key} {...s.props} />` | simplified charts |
| `getAxisProps()` in axis snippet | `<Axis placement="left" />` directly | simplified charts |
| `renderContext="canvas"` | `layer="canvas"` | simplified charts |
| `<Svg>` / `<Canvas>` / `<Html>` only | also `<Layer type="svg|canvas|html">` | layers |
| `fill-opacity=`, `stroke-width=` | `fillOpacity=`, `strokeWidth=` | primitives/marks |
| `<Axis x="left">` | `<Axis x="$left">` (positional shorthand) | Axis |
| `<Bar {bar} />` | `<Bar {data} />` | Bar |
| `<Points links />` | `<Points />` + `<Rule y={['start','end']} />` | Points |
| `bind:splineRef` | `bind:pathRef` | Spline |
| `labelOffset=` | `labelXOffset=` / `labelYOffset=` | Annotation* |
| `Legend classes={{ swatches }}` | `classes={{ item }}` | Legend |
| `defaultChartPadding(axis, legend)` | `defaultChartPadding({ axis, legend, left })` | util |
| `GeoContext` | `GeoProjection` | geo |
| `<Arc tooltipContext={{ mode: 'item' }} />` | `<Arc tooltip />` | Arc/Pie/Calendar/GeoPath |
| `getTooltipContext()`, `getRenderContext()` | `getChartContext()`, `getLayerContext()` | context |
| `ChartContextValue` type | `ChartState` | TS |
| `ctx.isVertical` | `ctx.valueAxis === 'y'` | ChartState |
| `item.payload`, `tooltipCtx.payload` | `ctx.tooltip.data`, `ctx.tooltip.series` | custom tooltips |
| `item.name` / `item.payload.color` | `item.label` / `item.config?.color` | custom tooltips |
| `<BrushContext bind:brushContext>` | `bind:state` | brush |
| `<TransformContext initialScrollMode>` | `scrollMode` (reactive) | transform |
| `transform={{ domainExtent: 'original' }}` | `domainExtent: 'data'` | transform |
| Brush props `mode`, `resetOnEnd`, `ignoreResetClick`, `onReset` | removed; see brush guide | brush |
| `Connector` | `Link` | component |
| `<Chart y={['a','b']}>` with `<Spline y="a" />` | omit chart `y`; marks register themselves | data |
| import `Tree`, `GeoPath`, `Sankey`, `ForceSimulation` from `'layerchart'` | from `layerchart/hierarchy`, `/geo`, `/graph`, `/force` | bundle |

Default tooltip modes changed: LineChart/AreaChart `bisect-x` → `quadtree-x`; ScatterChart
`voronoi` → `quadtree`.

Chart-level `props.spline/bars/...` are no longer applied when a custom `marks` snippet exists.
`points` snippet ≠ `marks` snippet (points only overrides point rendering).

New in v2 worth reaching for: `Layer`, `Path`, `Annotation*`, `BoxPlot`, `Violin`, `Density`,
`Contour`, `Raster`, `Cell`, `Chord`/`Ribbon`, `Image`, `Vector`, `Trail`, `Dodge`, `Waffle`,
`ArcLabel`, `CircleLegend`, `GeoLegend`, `ArcChart`, data-mode primitives, `ChartGroup`, facets
(`fx`/`fy`), `setSettings`, SSR image rendering, sub-path exports.

Full guides: `/docs/guides/migrations/v1-to-v2/llms.txt`,
`/docs/guides/migrations/state-refactor/llms.txt`.
