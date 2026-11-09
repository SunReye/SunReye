# LayerChart docs index (llms.txt scheme)

Base: `https://www.layerchart.com`

| What | Path |
| --- | --- |
| Root index (links to every page) | `/llms.txt` |
| Everything aggregated | `/docs/llms.txt` |
| Getting started | `/docs/getting-started/llms.txt` |
| Guide | `/docs/guides/<slug>/llms.txt` |
| Component | `/docs/components/<Name>/llms.txt` |
| Utility | `/docs/utils/<name>/llms.txt` |
| Example source (HTML page) | `/docs/components/<Name>/<example-slug>` |

Not every page supports `/llms.txt`; the root index lists the ones that do.

```bash
curl -sL https://www.layerchart.com/docs/components/Axis/llms.txt | sed -n '/^## API/,/^## Examples/p'
```

## Guide slugs

`animation`, `brush`, `bundle-size`, `chart-group`, `data`, `facets`, `geo`, `layers`, `LLMs`,
`primitives`, `scales`, `series`, `ssr-images`, `state`, `structure`, `styles`, `tooltip`,
`transform`, `migrations/v1-to-v2`, `migrations/state-refactor`.

## Components by category

**Simplified charts:** `LineChart`, `BarChart`, `AreaChart`, `ScatterChart`, `PieChart`, `ArcChart`

**Core / layout:** `Chart`, `ChartGroup`, `Layer`, `Svg`, `Canvas`, `Html`, `Group`, `Bounds`,
`Frame`, `ClipPath`, `ChartClipPath`, `RectClipPath`, `CircleClipPath`

**Marks (data-aware):** `Spline`, `Area`, `Bars`, `Bar`, `Points`, `Rule`, `Labels`, `Threshold`,
`Pie`, `Arc`, `ArcLabel`, `Cell`, `Calendar`, `Month`, `Waffle`, `BoxPlot`, `Violin`, `Density`,
`Contour`, `Raster`, `Hull`, `Voronoi`, `Dodge`, `Link`, `Trail`, `Vector`, `MotionPath`

**Primitives (svg/canvas/html):** `Circle`, `Ellipse`, `Rect`, `Line`, `Path`, `Polygon`, `Text`,
`Image`, `Marker`, `LinearGradient`, `RadialGradient`, `Pattern`, `Blur`

**Axes / reference:** `Axis`, `Grid`, `Legend`, `CircleLegend`, `GeoLegend`, `ColorRamp`,
`AnnotationLine`, `AnnotationPoint`, `AnnotationRange`

**Interaction:** `Tooltip` (`.Root/.Header/.List/.Item/.Separator`), `TooltipContext`,
`Highlight`, `Brush`, `BrushContext`, `TransformContext`

**Hierarchy (`layerchart/hierarchy`):** `Tree`, `Treemap`, `Pack`, `Partition`

**Graph (`layerchart/graph`):** `Sankey`, `Dagre`, `Chord`, `Ribbon`

**Force (`layerchart/force`):** `ForceSimulation`

**Geo (`layerchart/geo`):** `GeoPath`, `GeoProjection`, `GeoPoint`, `GeoCircle`, `GeoSpline`,
`GeoTile`, `TileImage`, `GeoRaster`, `GeoClipPath`, `GeoEdgeFade`, `GeoVisible`, `Graticule`

## Utilities

`/docs/utils/`: `cls`, `download`, `format`, `pivot`, `stats`, `string`

Also exported from root: `defaultChartPadding({ axis, legend, left, ... })`, `setSettings`,
`getSettings`, `getChartContext`, `getLayerContext`, `renderChart` / `ServerChart` (SSR images),
types `ChartState`, `SeriesData`, `ArcLabelPlacement`.

## Examples worth copying (slug → page)

| Task | Page |
| --- | --- |
| Sparkline in text | `LineChart/sparkline-within-a-paragraph`, `BarChart/sparkbar` |
| Multi-series + legend toggle | `LineChart/series`, `BarChart/legend-stack-series` |
| Stacked / 100% / diverging | `BarChart/stack-series`, `stack-series-expand`, `stack-series-diverging` |
| Grouped bars | `BarChart/group-series`, `BarChart/group-long-data` |
| Histogram | `BarChart/histogram-vertical`, `histogram-date-time-count` |
| Duration / Gantt | `BarChart/duration-bars`, `duration-bars-lanes` |
| Waterfall | `BarChart/waterfall` |
| Donut with center text | `PieChart/donut-with-text` |
| Radar | `LineChart/radar` |
| Gradient area | `AreaChart/gradient`, `AreaChart/threshold-gradient` |
| Null gaps | `LineChart/null-gaps`, `null-dashed-gaps` |
| Pan/zoom | `LineChart/pan-zoom`, `LineChart/pan-zoom-with-overview` |
| Brush to zoom | `LineChart/brush`, `BarChart/brush-band` |
| Streaming | `LineChart/perf-streaming`, `LineChart/dynamic-data` |
| Custom tooltip | `LineChart/custom-tooltip`, `Tooltip/custom-content` |
| Heatmap | `Cell/color-scale`, `Calendar` |
| Choropleth | `GeoPath/choropleth` |
| Dual axis | `Chart/compound-dual-axis-with-stacked-charts` |
| Facets | `Chart/facet-x`, `Chart/facet-grid`, `BarChart/facet-stack-long-data` |
