# Data shapes, series, layouts

## Accessors

| Level | Form | Notes |
| --- | --- | --- |
| Chart `x`/`y`/`c`/`r`/`z`/`x1`/`y1`/`fx`/`fy` | `"prop"`, `(d) => ...`, `['a','b']` | Array = multiple props in domain, or an interval `[start,end]` |
| Mark `y="apples"` | per-mark accessor | Registers with chart automatically → no need for chart `y={[...]}` |
| Mark `data={rows}` | per-mark data | Included in domain; resolution order: mark data → series data → chart data |
| Primitive `cx="date"` | DataProp | string/function = data mode (one per row through scales); number = pixel |
| `flatData` | flat array | Required when `data` is hierarchy / sankey / d3 `stack()` output |

Omit chart `x`/`y` and let marks register when marks differ. Chart-level is one render pass,
mark-level registers after mount (two passes) — prefer chart-level for large data.

## Wide format (column per series)

```ts
const data = [{ date, apples: 100, bananas: 80 }, ...];
```

```svelte
<BarChart {data} x="date" series={[
	{ key: 'apples', label: 'Apples', color: 'var(--chart-1)' },
	{ key: 'bananas', label: 'Bananas', color: 'var(--chart-2)', selected: false }
]} legend />
```

## Long / tidy format (category column)

```ts
const data = [{ year: 2019, fruit: 'apples', value: 3840 }, { year: 2019, fruit: 'bananas', value: 1920 }, ...];
```

```svelte
<LineChart {data} x="year" y="value" c="fruit" legend />          <!-- one line per fruit -->
<BarChart  {data} x="year" y="value" c="fruit" legend />          <!-- auto-stacks by c -->
<BarChart  {data} x="year" x1="fruit" y="value" c="fruit" seriesLayout="group" legend />  <!-- grouped: needs x1 AND group -->
```

Split resolution for `Spline`/`Area` (first set wins): mark `z` → chart `z` → mark
`stroke`/`fill` naming a column → chart `c` **only if it names a column** (computed `c` fn or
continuous `c` = color, not split). Use `z="id" c="group"` when split ≠ color. Legend items = `c`
categories; click filters, hover fades.

Pivot long → wide when you need per-series `label`/`props`/order/own `data`:

```ts
import { flatGroup } from 'd3-array';
const wide = flatGroup(long, d => d.year).map(([year, rows]) => ({
	year, ...Object.fromEntries(rows.map(d => [d.fruit, d.value]))
}));
```

## Per-series data (different lengths / sources)

```svelte
<LineChart x="date" y="value" series={[
	{ key: 'actual', data: actualData },
	{ key: 'forecast', data: forecastData, props: { class: '[stroke-dasharray:4_2]' } }
]} />
```

Stacking aligns per-series arrays by the x key.

## `SeriesData` fields

| Field | Type | Purpose |
| --- | --- | --- |
| `key` | string (required) | data property or id |
| `label` | string | legend/tooltip name (default key) |
| `value` | accessor | custom value (default `key` prop); **required per series** when stacking shared data on raw `<Chart>` |
| `data` | array | per-series rows |
| `color` | string | any CSS color / var |
| `selected` | boolean | initial visibility, reactive |
| `props` | object | forwarded to the mark (`Spline`/`Bars`/`Area`/`Points`/`Arc` props) |
| `maxValue` | number | for single-item gauge-style data |

## `seriesLayout`

| Value | Behavior |
| --- | --- |
| `auto` (default) | stack when ≥2 `series` or ordinal `c`; never for lines, points, intervals, marks with own `data`; stacks about zero |
| `overlap` | each drawn from axis |
| `stack` | running total, same direction |
| `stackExpand` | normalized 100% |
| `stackDiverging` | positives up, negatives down |
| `group` | side-by-side sub-bands (bars only, never inferred); long data needs `x1` |

BarChart extras: `bandPadding` (0.4), `groupPadding`, `stackPadding`, `orientation="horizontal"`
(then `y` is the band, `y1` the sub-band), `onBarClick`.

Sub-band + stack (grouped stacks): `x1="basket" x1Scale={scaleBand().padding(0.1)}
x1Range={({ xScale }) => [0, xScale.bandwidth()]} series={[...]} seriesLayout="stack"`.

## Series state (`context.series`)

Props: `series`, `visibleSeries`, `selectedKeys` (`toggle(key)`, `clear()` = all visible),
`highlightKey`, `isStacked`, `allSeriesData`, `visibleSeriesData` (rows + `seriesKey`).
Methods: `isVisible(key)`, `isHighlighted(key)`, `setHighlight(key)`, `getStackValue(key, d)`,
`getStackAccessors(key)`.

Custom legend / persisted selection:

```svelte
<script lang="ts">
	let context = $state<ChartState>(null!);
</script>
{#each series as s}
	<button onclick={() => context?.series.selectedKeys.toggle(s.key)}>{s.label}</button>
{/each}
<LineChart bind:context {data} x="date" {series} />
```

Highlight-driven labels:

```svelte
{#snippet aboveMarks({ context })}
	{#if context.series.highlightKey}<Labels seriesKey={context.series.highlightKey} offset={10} />{/if}
{/snippet}
```

## Mixed marks on `<Chart>`

```svelte
{#each context.series.visibleSeries as s (s.key)}<Bars seriesKey={s.key} />{/each}
<Spline y="target" />            <!-- own accessor, shares scale -->
<Spline data={targets} y="target" />   <!-- own rows -->
<Spline seriesKey="apples" />    <!-- follows that series' stacked top -->
```

## Scales cheat sheet

- Override type: `xScale={scaleLog()}`, `xScale={scalePoint()}`, `xScale={scaleBand().padding(0.2)}`.
- Domain: `yDomain={[0, null]}`, `xDomain={[start, end]}`, `cDomain={['a','b']}` (ordering!),
  `yNice`, `xPadding={[10, 10]}` (px), `yBaseline={0}`, `xReverse`.
- Time buckets: `xInterval={timeDay}` (d3-time) for band-like time axes.
- Color: `cRange={schemeTableau10}`, `cScale={scaleThreshold().domain([0, 50]).range([...])}`,
  `cScale={scaleSequential(interpolateBlues)}`.
- Read in code: `context.xScale(v)`, `context.xGet(d)`, `context.cGet(d)`, `context.xScale.bandwidth?.()`.
