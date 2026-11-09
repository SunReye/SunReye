# Styling, theming, SSR

## Color model

Everything defaults to `currentColor`; LayerChart maps it to `fill`/`stroke` (SVG),
`fillStyle` (Canvas), `color`/`background` (HTML). Set color by any of:

```svelte
<Spline class="stroke-primary" />                 <!-- Tailwind / UnoCSS, also works in Canvas -->
<Area style="fill: var(--chart-1); fill-opacity: .2" />
<Bars fill="var(--chart-2)" fillOpacity={0.6} />   <!-- camelCase attrs -->
<Text class="text-xs fill-surface-content" />
<Circle fill={(d) => d.ok ? 'var(--color-ok)' : 'var(--color-bad)'} />  <!-- data mode fn -->
<Rect fill="group" />                             <!-- data key → cScale -->
```

## Global variables (`.lc-root-container`)

| Var | Role |
| --- | --- |
| `--color-primary` | default mark color |
| `--color-surface-100/200/300` | backgrounds, tooltip, brush, progressively darker |
| `--color-surface-content` | text / axis |

Presets that map framework tokens onto these (import ONE in `app.css`):
`layerchart/shadcn-svelte.css`, `layerchart/skeleton-3.css|-4.css|-5.css`,
`layerchart/daisyui-5.css`; Svelte UX works as-is. No framework → `@import 'layerchart/core.css'`
(sets `@layer theme, base, components, utilities`; otherwise prod build cascade order can flip).

Dark mode: `.dark .lc-root-container { --color-...: ... }` or
`@media (prefers-color-scheme: dark)`; per-mark `class="fill-blue-200 dark:fill-blue-900"`.

## Component style hooks

- Every component: `class`, `style`, style attrs (`fill`, `stroke`, `strokeWidth`, `opacity`,
  `strokeDasharray`), and a stable `lc-*` class (`.lc-axis`, `.lc-grid`, `.lc-spline`, `.lc-rect`,
  `.lc-tooltip`) selected via `:where()` — override with plain CSS, no `!important`.
- `classes={{ ... }}` for inner parts:
  - `Axis`: `root`, `label`, `rule`, `tick`, `tickLabel`
  - `Legend`: `root`, `title`, `label`, `tick`, `items`, `swatch`, `item` (string or `(item) => string`)
  - `Tooltip.Root`: `root`, `container`, `content`, `header`
  - Brush: `brush={{ classes: { range, handle } }}`
- `props={{ ... }}` for inner components: chart `props.xAxis/yAxis/grid/rule/spline/area/bars/points/labels/legend/tooltip/highlight`; `AnnotationPoint props={{ circle, label }}`; `Area line={{ class: 'stroke-2' }}`.

## Axis essentials

`<Axis placement="left|right|top|bottom|angle|radius" grid rule label="Revenue" format="metric"
ticks={5} tickSpacing={60} tickOcclusion tickMultiline tickMarks={false} classes={{...}} />`.
`format` accepts `'integer' | 'decimal' | 'currency' | 'percent' | 'metric' | 'day' | 'month' |
'year' | 'percentRound' | 'none' | 'custom' (with `{ custom: 'eee, MMM do' }`) | (v) => string | FormatConfig`; same set as `format()` from `@layerstack/utils`. `tickOcclusion={{ priority: 'start-end' }}` drops
overlapping labels by measured width; `tickSpacing` only picks a count.

## Color scales & legends

```ts
import { scaleOrdinal, scaleSequential, scaleThreshold, scaleQuantize } from 'd3-scale';
import { schemeTableau10, interpolateViridis } from 'd3-scale-chromatic';
```

```svelte
<BarChart {data} x="k" y="v" c="k" cRange={schemeTableau10} />
<BarChart {data} x="k" y="v" c="v" cScale={scaleThreshold().domain([50]).range(['var(--color-bad)', 'var(--color-ok)'])} />
<Legend scale={scaleSequential([0, 100], interpolateViridis)} title="°F" variant="ramp|swatches" placement="top-right" />
```

Legend on a chart: `legend` / `legend={{ placement: 'top', orientation: 'vertical' }}` — items
come from `series` or `c` categories; click toggles, hover highlights.

## Gradients / patterns

```svelte
<LinearGradient class="from-primary/50 to-primary/0" vertical>
	{#snippet children({ gradient })}<Area fill={gradient} />{/snippet}
</LinearGradient>
<RadialGradient stops={['hsl(60 100% 50%)', 'hsl(30 100% 40%)']}>{#snippet children({ gradient })}<Circle r={150} fill={gradient} />{/snippet}</RadialGradient>
<Pattern id="stripes" ...>  <!-- see AnnotationRange/vertical-with-pattern-range -->
```

`AreaChart/gradient` and `AreaChart/threshold-gradient` examples show gradient encoding with
simplified charts via `marks` snippet.

## Padding & sizing

`padding={24}` | `{ top, right, bottom, left }` | `defaultChartPadding({ axis: 'x', legend: true, left: 48 })`.
Charts are width-responsive; set `height` (px) or a sized parent. `onResize` callback available.
Sparklines: `<LineChart {data} x y axis={false} grid={false} rule={false} tooltipContext={false} height={20} class="inline-block w-24" />`.

## SSR images (server-rendered PNG/JPEG)

Guide: `/docs/guides/ssr-images/llms.txt`. `renderChart(component, { width, height, props })`
in a `+server.ts` endpoint; `<ServerChart>` wrapper. CSS vars are unavailable server-side → pass
literal colors (`<Axis stroke="#999" fill="#333" />`, `fill="#2563eb"`), set `ssr` on `<Chart>`,
disable motion. Cloudflare/edge and high-DPI notes in guide.

## In this repo

shadcn-svelte + Tailwind v4, `components.json` aliases `$lib/components/ui`. Prefer
`bun x shadcn-svelte@latest add -y -o chart` → `Chart.Container` (maps `chartConfig` keys to
`--color-<key>`), `Chart.Tooltip`, `Chart.ChartConfig`. Semantic colors only: `var(--chart-1..5)`,
`text-muted-foreground`, never raw `bg-blue-500`. Follow `apps/web/DESIGN.md`.
