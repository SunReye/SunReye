<script lang="ts">
	// Canvas render context like every other chart added to the statistics page:
	// grouped bars over twelve months are cheap today, but the SVG context is
	// what froze weak devices once the band count grew (see price-track-chart).
	import { BarChart } from 'layerchart/canvas';
	import type { ChartState } from 'layerchart';
	import * as Chart from '$lib/components/ui/chart';
	import ChartLegend from '$lib/components/inverter/chart-legend.svelte';
	import SeriesTooltip from './series-tooltip.svelte';
	import { seriesConfig } from '$lib/components/inverter/_shared/chart-series';
	import { canvasHighlight } from '$lib/components/inverter/_shared/canvas-highlight.svelte';
	import { barBandPadding, chartPaddingFor, periodLabel, xTickSpacingFor } from '$lib/cost/ranges';
	import { CHART_BOX } from '$lib/layout/tokens';
	import ZoomControls from '$lib/charts/zoom-controls.svelte';
	import { chartZoom } from '$lib/charts/zoom.svelte';
	import type { YoyRow } from '$lib/statistics/yoy';

	let {
		rows,
		year,
		format,
		color
	}: {
		rows: YoyRow[];
		/** The current year; the reference series is `year − 1`. */
		year: number;
		/** Formats a value for the tooltip, e.g. money or kWh. */
		format: (v: number) => string;
		/** Hue of the metric being charted. */
		color: string;
	} = $props();

	// One hue, two intensities: the years are the same measure, so a second hue
	// would imply a second meaning. The reference year is the same colour mixed
	// toward the surface, which keeps the pair distinguishable for every kind of
	// colour vision (dataviz skill: lightness ordering, not hue coding).
	//
	// The keys are the row fields on purpose. A grouped BarChart positions each
	// series with `x1 = series.value ?? series.key`, so an accessor *function*
	// here would be handed to a band scale as its lookup key and every bar would
	// land at NaN — nothing renders. Naming the field and omitting `value` keeps
	// the lookup a string, and leaves a monthless gap null rather than a zero bar.
	const series = $derived([
		{ key: 'current', label: `${year}`, color },
		{
			key: 'previous',
			label: `${year - 1}`,
			color: `color-mix(in oklab, ${color} 40%, var(--color-background))`
		}
	]);

	const config = $derived(seriesConfig(series));
	const data = $derived(rows.map((r) => ({ ...r, label: periodLabel(r.bucket, 'month') })));

	// Canvas can't read the `.lc-highlight-area` wash off CSS; without a concrete
	// colour the hovered month gets an opaque slab over it.
	const highlight = canvasHighlight();

	// Both bar paddings below are d3 band fractions, not pixels: `groupPadding: 1`
	// is the degenerate maximum and collapses each pair to zero width.

	// The gutters follow the plot's MEASURED width, not a breakpoint: this chart
	// renders full-bleed on one page and inside a two-up grid on another, so only
	// the element knows how much room it got. 0 until it is in the document,
	// which chartPaddingFor reads as the desktop case.
	let plotWidth = $state(0);

	// Twelve grouped pairs, and the comparison IS the twelve months — there is no
	// finer year-over-year series to fetch, so a zoom here narrows the domain in
	// place rather than telling an owner to refetch.
	const zoom = chartZoom();
</script>

<!-- The chart context, taken where it is reachable. LayerChart's canvas
     wrappers do not re-export `context` as bindable, and the reset control has
     to reach the transform state to undo a gesture. `belowContext` renders
     outside the drawing layer, so capturing here adds no mark of its own. -->
{#snippet belowContext({ context }: { context: ChartState<YoyRow> })}{zoom.capture(context)}{/snippet}

<div class="flex min-w-0 flex-col gap-3" bind:this={highlight.el} bind:clientWidth={plotWidth}>
	<div class="relative">
		<ZoomControls {zoom} />
		<Chart.Container {config} class="{CHART_BOX} w-full min-w-0">
			<BarChart
				{data}
				x="label"
				{series}
				seriesLayout="group"
				bandPadding={barBandPadding(data.length, 0.2)}
				groupPadding={0.1}
				padding={chartPaddingFor(plotWidth)}
				props={{ xAxis: { tickSpacing: xTickSpacingFor(plotWidth) } }}
				highlight={{ area: { fill: highlight.fill, fillOpacity: 0.1 } }}
				{...zoom.props}
				{belowContext}
			>
				{#snippet tooltip()}
					<SeriesTooltip {format} />
				{/snippet}
			</BarChart>
		</Chart.Container>
	</div>
	<ChartLegend items={series} />
</div>
