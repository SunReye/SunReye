<script lang="ts" generics="Row extends { label: string }">
	// The statistics page's line-chart shell: one canvas LineChart over a period
	// series, with the house Chart.Container + seriesConfig + ChartLegend trio and
	// a value-formatted tooltip. Both energy line charts render through this, so
	// they stay pixel-identical and only differ in the series they build.
	//
	// Canvas render context: a year window is hundreds of points across up to six
	// series, far past the band count where the SVG context freezes weak devices
	// (see forecast-chart.svelte).
	import { LineChart } from 'layerchart/canvas';
	import { scalePoint } from 'd3-scale';
	import * as Chart from '$lib/components/ui/chart';
	import ChartLegend from '$lib/components/inverter/chart-legend.svelte';
	import SeriesTooltip from './series-tooltip.svelte';
	import {
		seriesConfig,
		type LabelledSeries
	} from '$lib/components/inverter/_shared/chart-series';
	import { COST_CHART_PADDING, COST_X_TICK_SPACING } from '$lib/cost/ranges';

	let {
		data,
		series,
		format,
		yDomain
	}: {
		/** Rows in period order; `label` is the x-axis band. */
		data: Row[];
		series: (LabelledSeries & { value: (d: Row) => number | null })[];
		/** Renders one value for the axis and the tooltip. */
		format: (v: unknown) => string;
		/** Fixed y domain — ratios pin [0, 1]; kWh charts scale to their data. */
		yDomain?: [number, number];
	} = $props();

	const config = $derived(seriesConfig(series));
	const axisPadding = COST_CHART_PADDING;
</script>

<div class="flex min-w-0 flex-col gap-3">
	<Chart.Container {config} class="h-64 w-full min-w-0">
		<LineChart
			{data}
			x="label"
			xScale={scalePoint()}
			{series}
			{yDomain}
			padding={axisPadding}
			props={{
				xAxis: { tickSpacing: COST_X_TICK_SPACING },
				yAxis: { format },
				// A line is a stroke, never a fill — but the `fill: none` default for
				// `.lc-path` ships in LayerChart's *SVG* Path component, which a
				// canvas-only import never pulls in. Without this the renderer reads
				// the initial `fill: black` off its style probe and floods the area
				// the polyline encloses.
				spline: { fill: 'none' }
			}}
		>
			{#snippet tooltip()}
				<SeriesTooltip {format} />
			{/snippet}
		</LineChart>
	</Chart.Container>
	<ChartLegend items={series} />
</div>
