<script lang="ts" module>
	/** One stacked series of the block; `value` reads it off a labelled period. */
	export type SplitSeries<Row> = {
		key: string;
		label: string;
		color: string;
		value: (d: Row) => number;
	};
</script>

<script lang="ts" generics="Row extends { label: string }">
	// One side of the energy split: a titled stacked bar chart with the window's
	// average ratio (and its change) in the header. Extracted from
	// energy-split-chart so the two sides share one definition and neither
	// template grows past reading size.
	import { BarChart } from 'layerchart';
	import * as Chart from '$lib/components/ui/chart';
	import * as msg from '$lib/paraglide/messages';
	import ChartLegend from '$lib/components/inverter/chart-legend.svelte';
	import DeltaChip from '$lib/components/statistics/delta-chip.svelte';
	import { seriesConfig, stackedBarProps } from '$lib/components/inverter/_shared/chart-series';
	import { CHART_BOX_SHORT } from '$lib/layout/tokens';

	// The gutters follow the plot's MEASURED width, not a breakpoint: the two
	// halves of the split sit side by side on a laptop and stack on a phone, so
	// only the element knows how much room it got. Per instance, not module-level:
	// both halves render this component. 0 until it is in the document, which
	// stackedBarProps reads as the desktop case.
	let plotWidth = $state(0);

	let {
		title,
		subtitle,
		series,
		data,
		seriesLayout,
		ratio,
		delta,
		baseline
	}: {
		title: string;
		subtitle: string;
		series: SplitSeries<Row>[];
		data: Row[];
		/** 'stack' for kWh, 'stackExpand' for the 100%-normalized share. */
		seriesLayout: 'stack' | 'stackExpand';
		/** Window average of the ratio this side describes; null when there was
		 *  no flow to divide by. */
		ratio: number | null;
		/** Change of that ratio against the reference window. Undefined hides the
		 *  chip — the chart is not plotting the picked window. */
		delta?: number | null;
		baseline?: string;
	} = $props();

	const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
	const config = $derived(seriesConfig(series));
</script>

<!-- min-w-0 lets the grid column shrink below the chart's intrinsic width;
     without it the block overflows the section edge on narrow screens. -->
<div class="flex min-w-0 flex-col gap-3" bind:clientWidth={plotWidth}>
	<div class="flex items-baseline justify-between gap-3">
		<div class="flex flex-col">
			<h3 class="text-sm font-medium">{title}</h3>
			<span class="text-xs text-muted-foreground">{subtitle}</span>
		</div>
		<span
			class="flex shrink-0 items-baseline gap-2 whitespace-nowrap text-sm tabular-nums text-muted-foreground"
		>
			<span>
				{msg.chart_avg()} <span class="font-semibold text-foreground">{pct(ratio)}</span>
			</span>
			{#if delta !== undefined}
				<DeltaChip {delta} goodDirection="up" {baseline} />
			{/if}
		</span>
	</div>
	<Chart.Container {config} class="{CHART_BOX_SHORT} w-full">
		<BarChart
			{data}
			x="label"
			{series}
			{seriesLayout}
			{...stackedBarProps(data.length, plotWidth)}
		>
			{#snippet tooltip()}
				<Chart.Tooltip />
			{/snippet}
		</BarChart>
	</Chart.Container>
	<ChartLegend items={series} />
</div>
