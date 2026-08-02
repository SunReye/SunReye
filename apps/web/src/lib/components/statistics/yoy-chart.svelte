<script lang="ts">
	// Canvas render context like every other chart added to the statistics page:
	// grouped bars over twelve months are cheap today, but the SVG context is
	// what froze weak devices once the band count grew (see price-track-chart).
	import { BarChart } from 'layerchart/canvas';
	import * as Chart from '$lib/components/ui/chart';
	import ChartLegend from '$lib/components/inverter/chart-legend.svelte';
	import SeriesTooltip from './series-tooltip.svelte';
	import { seriesConfig } from '$lib/components/inverter/_shared/chart-series';
	import { periodLabel } from '$lib/cost/ranges';
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
	const series = $derived([
		{
			key: 'current',
			label: `${year}`,
			color,
			value: (d: YoyRow) => d.current ?? 0
		},
		{
			key: 'previous',
			label: `${year - 1}`,
			color: `color-mix(in oklab, ${color} 40%, var(--color-background))`,
			value: (d: YoyRow) => d.previous ?? 0
		}
	]);

	const config = $derived(seriesConfig(series));
	const data = $derived(rows.map((r) => ({ ...r, label: periodLabel(r.bucket, 'month') })));
</script>

<div class="flex min-w-0 flex-col gap-3">
	<Chart.Container {config} class="h-64 w-full min-w-0">
		<BarChart
			{data}
			x="label"
			{series}
			seriesLayout="group"
			bandPadding={0.2}
			groupPadding={1}
			padding={{ top: 8, right: 8, bottom: 20, left: 52 }}
			props={{ xAxis: { ticks: 6 } }}
		>
			{#snippet tooltip()}
				<SeriesTooltip {format} />
			{/snippet}
		</BarChart>
	</Chart.Container>
	<ChartLegend items={series} />
</div>
