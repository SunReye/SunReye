<script lang="ts">
	// The plot of a custom chart, in whichever of its three forms applies: the
	// gliding live window, or a historical area chart — dual-axis when the series
	// span more than one unit (marks drawn by hand so each axis keeps its real
	// values while the series share a normalized [0,1] scale), otherwise
	// LayerChart's plain filled area on one axis.
	import { AreaChart, Area, Highlight } from 'layerchart';
	import { curveCatmullRom } from 'd3-shape';
	import * as Chart from '$lib/components/ui/chart';
	import DualYAxes from '$lib/components/inverter/_shared/dual-y-axes.svelte';
	import CustomChartTooltip from '$lib/components/inverter/custom-chart-tooltip.svelte';
	import CustomLiveChart from '$lib/components/inverter/custom-live-chart.svelte';
	import type { ResolvedAxes } from '$lib/components/inverter/_shared/chart-series';
	import { fittedPadding } from '$lib/charts/plot-padding';
	import type { AxisSeries, Datum } from '$lib/inverter/chart-axes';

	// Two bases, because the two forms carry different things in their right
	// gutter: the dual-axis form draws a SECOND set of tick labels there (see
	// DualYAxes), the single-axis form only the last x label's overhang. Both
	// narrow on a phone, but an axis gutter narrows to axis-label room, not to
	// the 8px overhang cap — hence the `rightAxis` flag below.
	const DUAL_AXIS_PADDING = { top: 8, right: 44, bottom: 28, left: 44 };
	const PADDING = { top: 8, right: 8, bottom: 28, left: 44 };

	// Fitted to the MEASURED plot: a custom chart card spans one, two or three
	// grid columns depending on how the user sized it, so no breakpoint knows.
	let plotWidth = $state(0);

	let {
		live,
		data,
		series,
		config,
		axes,
		xDomain,
		labelFormatter,
		xTickFormat
	}: {
		/** Live mode streams from the store into its own gliding window. */
		live: boolean;
		data: Datum[];
		series: AxisSeries[];
		config: Chart.ChartConfig;
		axes: ResolvedAxes;
		/** The whole selected window, so a partial day still spans the full range. */
		xDomain: [Date, Date];
		labelFormatter: (v: unknown) => string;
		xTickFormat: (v: unknown) => string;
	} = $props();

	// AreaChart's `marks` context isn't exposed in the public types; type just the
	// fields the dual-axis marks snippet reads.
	type MarksContext = {
		context: { height: number; series: { visibleSeries: { key: string }[] } };
	};
</script>

<!-- One measuring box around all three forms: the plot is the same box whichever
     branch renders, and measuring per-branch would re-measure on every switch. -->
<div class="h-full w-full" bind:clientWidth={plotWidth}>
	{#if live}
		<CustomLiveChart {data} {series} {config} {labelFormatter} />
	{:else if axes.grouping.dualAxis}
		<Chart.Container {config} class="aspect-auto h-full w-full">
			<AreaChart
				{data}
				x="date"
				series={axes.plotSeries}
				{xDomain}
				yDomain={[0, 1]}
				seriesLayout="overlap"
				axis="x"
				grid={false}
				highlight={false}
				padding={fittedPadding(DUAL_AXIS_PADDING, plotWidth, { rightAxis: true })}
				props={{ xAxis: { format: xTickFormat, ticks: 4 } }}
			>
				{#snippet marks({ context }: MarksContext)}
					<DualYAxes height={context.height} {axes} />
					{#each context.series.visibleSeries as s (s.key)}
						<Area
							seriesKey={s.key}
							curve={curveCatmullRom}
							fillOpacity={0}
							line={{ 'stroke-width': 1.5 }}
						/>
					{/each}
					<Highlight points lines />
				{/snippet}
				{#snippet tooltip()}
					<CustomChartTooltip {series} {labelFormatter} />
				{/snippet}
			</AreaChart>
		</Chart.Container>
	{:else}
		<Chart.Container {config} class="aspect-auto h-full w-full">
			<AreaChart
				{data}
				x="date"
				{series}
				{xDomain}
				seriesLayout="overlap"
				axis
				grid
				padding={fittedPadding(PADDING, plotWidth)}
				props={{
					area: { curve: curveCatmullRom, fillOpacity: 0.2, line: { 'stroke-width': 1.5 } },
					xAxis: { format: xTickFormat, ticks: 4 }
				}}
			>
				{#snippet tooltip()}
					<CustomChartTooltip {series} {labelFormatter} />
				{/snippet}
			</AreaChart>
		</Chart.Container>
	{/if}
</div>
