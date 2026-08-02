<script lang="ts">
	// Canvas render context like every other chart added to the statistics page:
	// grouped bars over twelve months are cheap today, but the SVG context is
	// what froze weak devices once the band count grew (see price-track-chart).
	import { BarChart } from 'layerchart/canvas';
	import * as Chart from '$lib/components/ui/chart';
	import ChartLegend from '$lib/components/inverter/chart-legend.svelte';
	import SeriesTooltip from './series-tooltip.svelte';
	import { seriesConfig } from '$lib/components/inverter/_shared/chart-series';
	import { canvasHighlight } from '$lib/components/inverter/_shared/canvas-highlight.svelte';
	import {
		barBandPadding,
		COST_CHART_PADDING,
		COST_X_TICK_SPACING,
		periodLabel
	} from '$lib/cost/ranges';
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
</script>

<div class="flex min-w-0 flex-col gap-3" bind:this={highlight.el}>
	<Chart.Container {config} class="h-64 w-full min-w-0">
		<BarChart
			{data}
			x="label"
			{series}
			seriesLayout="group"
			bandPadding={barBandPadding(data.length, 0.2)}
			groupPadding={0.1}
			padding={COST_CHART_PADDING}
			props={{ xAxis: { tickSpacing: COST_X_TICK_SPACING } }}
			highlight={{ area: { fill: highlight.fill, fillOpacity: 0.1 } }}
		>
			{#snippet tooltip()}
				<SeriesTooltip {format} />
			{/snippet}
		</BarChart>
	</Chart.Container>
	<ChartLegend items={series} />
</div>
