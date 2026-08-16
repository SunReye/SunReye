<script lang="ts">
	// Canvas render context: today + tomorrow at quarter-hour resolution is ~192
	// bands, far past the point where the SVG context freezes weak devices for
	// seconds (measured INP ~3 s vs ~90 ms at 24 bands, see forecast-chart).
	// Canvas draws the same marks without the per-band DOM.
	import { BarChart, Rect, Rule } from 'layerchart/canvas';
	import type { ChartState } from 'layerchart';
	import * as Chart from '$lib/components/ui/chart';
	import ChartLegend from '$lib/components/inverter/chart-legend.svelte';
	import PriceTooltip from './price-tooltip.svelte';
	import { seriesConfig } from '$lib/components/inverter/_shared/chart-series';
	import { canvasHighlight } from '$lib/components/inverter/_shared/canvas-highlight.svelte';
	import { chartPaddingFor, xTickSpacingFor } from '$lib/cost/ranges';
	import { CHART_BOX } from '$lib/layout/tokens';
	import { bandSpan, negativeBandRuns, type PriceRow } from '$lib/prices/price-series';
	import ZoomControls from '$lib/charts/zoom-controls.svelte';
	import { chartZoom } from '$lib/charts/zoom.svelte';
	import { clipRunsToDomain, isBandVisible } from '$lib/charts/visible-bands';
	import * as m from '$lib/paraglide/messages';

	let {
		rows,
		nowKey = null
	}: {
		rows: PriceRow[];
		/**
		 * Band the "now" marker sits on (a row `label`), or null for a curve that
		 * doesn't contain this instant — tomorrow's, above all. Passed in rather
		 * than derived here so the marker ticks on the caller's clock instead of
		 * every chart owning a timer.
		 */
		nowKey?: string | null;
	} = $props();

	// Two series so the bars diverge around zero (same technique as the cost
	// chart): exactly one is non-zero per band, so the axis crosses at zero
	// without a forced domain.
	//
	// Colours are taken from the existing validated set rather than adding a hue.
	// The price itself is the subject of this chart, so it gets a hue rather than
	// the reference grey it used to wear (which read as disabled); the negative
	// half borrows the battery magenta on purpose — a negative slot is precisely
	// when the pack should be absorbing, so the colour link carries meaning.
	const series = [
		{
			key: 'positiveCt',
			label: m.prices_series_price(),
			color: 'var(--color-energy-export)',
			value: (d: PriceRow) => d.positiveCt
		},
		{
			key: 'negativeCt',
			label: m.prices_series_negative(),
			color: 'var(--color-energy-battery)',
			value: (d: PriceRow) => d.negativeCt
		}
	];

	const config = seriesConfig(series);

	// Canvas can't read the `.lc-highlight-area` CSS wash; see canvasHighlight.
	const highlight = canvasHighlight();

	// Only label the legend's negative swatch when something is actually
	// negative, so an ordinary day keeps a one-swatch row.
	const negativeRuns = $derived(negativeBandRuns(rows));
	const legend = $derived(
		negativeRuns.length > 0 ? series : series.filter((s) => s.key === 'positiveCt')
	);

	// The gutters follow the plot's MEASURED width, not a breakpoint: this chart
	// renders full-bleed on one page and inside a two-up grid on another, so only
	// the element knows how much room it got. 0 until it is in the document,
	// which chartPaddingFor reads as the desktop case.
	let plotWidth = $state(0);

	// Quarter-hour bands are ~2px wide across today+tomorrow on a phone, which is
	// exactly the chart worth zooming — and there is nothing finer to fetch, so
	// the narrowed domain IS the answer here rather than a signal to an owner.
	const zoom = chartZoom();

	// Every band the rows carry, in order. The marks below position themselves by
	// looking a band up in the CURRENT x scale, so they need the full list to
	// clip against once a zoom has narrowed that scale.
	const allLabels = $derived(rows.map((r) => r.label));
</script>

<!-- Drawn over the bars, inside the chart layer: a dashed rule on the band the
     current slot occupies, so "where are we in the day" needs no reading of the
     axis. Canvas can't resolve a CSS stroke either, hence the concrete colour. -->
<!-- Behind the bars: the stretches where power is free or paid-for. A
     quarter-hour at −0.5 ct is a hairline next to a 20 ct peak, so without the
     shading the one thing this curve is read for is invisible. -->
<!-- The chart context, taken where it is reachable. LayerChart's canvas
     wrappers do not re-export `context` as bindable, and the reset control has
     to reach the transform state to undo a gesture. `belowContext` renders
     outside the drawing layer, so capturing here adds no mark of its own. -->
{#snippet belowContext({ context }: { context: ChartState<PriceRow> })}{zoom.capture(context)}{/snippet}

{#snippet belowMarks({ context }: { context: ChartState<PriceRow> })}
	<!-- Clipped to the visible domain: a zoom drops bands from the x scale, and
	     `bandSpan` reads the resulting `undefined` as 0 — so an unclipped run
	     that scrolled off does not vanish, it re-draws at the left edge and
	     claims the wrong quarter-hours were free. -->
	{#each clipRunsToDomain(negativeRuns, allLabels, context.xScale.domain()) as run (run.first)}
		{@const span = bandSpan(context.xScale, run)}
		<Rect
			x={span.x}
			y={0}
			width={span.width}
			height={context.height}
			fill="var(--color-energy-battery)"
			fillOpacity={0.12}
		/>
	{/each}
{/snippet}

{#snippet aboveMarks({ context }: { context: ChartState<PriceRow> })}
	{#if isBandVisible(nowKey, context.xScale.domain())}
		<Rule x={nowKey} stroke={highlight.fill} strokeWidth={1} dashArray="4 3" />
	{/if}
{/snippet}

<div class="flex min-w-0 flex-col gap-3" bind:this={highlight.el} bind:clientWidth={plotWidth}>
	<div class="relative">
		<ZoomControls {zoom} />
		<Chart.Container {config} class="{CHART_BOX} w-full min-w-0">
			<BarChart
				data={rows}
				x="label"
				{series}
				seriesLayout="stackDiverging"
				bandPadding={0.1}
				padding={chartPaddingFor(plotWidth)}
				props={{ xAxis: { tickSpacing: xTickSpacingFor(plotWidth) } }}
				highlight={{ area: { fill: highlight.fill, fillOpacity: 0.1 } }}
				{...zoom.props}
				{belowContext}
				{belowMarks}
				{aboveMarks}
			>
				{#snippet tooltip()}
					<PriceTooltip />
				{/snippet}
			</BarChart>
		</Chart.Container>
	</div>
	<ChartLegend items={legend} />
</div>
