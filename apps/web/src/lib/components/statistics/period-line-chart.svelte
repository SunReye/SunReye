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
	import { chartPaddingFor, xTickSpacingFor } from '$lib/cost/ranges';
	import { CHART_BOX } from '$lib/layout/tokens';

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

	// The gutters follow the plot's MEASURED width, not a breakpoint: this chart
	// renders full-bleed on one page and inside a two-up grid on another, so only
	// the element knows how much room it got. 0 until it is in the document,
	// which chartPaddingFor reads as the desktop case.
	let plotWidth = $state(0);
</script>

<div class="flex min-w-0 flex-col gap-3" bind:clientWidth={plotWidth}>
	<Chart.Container {config} class="{CHART_BOX} w-full min-w-0">
		<LineChart
			{data}
			x="label"
			xScale={scalePoint()}
			{series}
			{yDomain}
			padding={chartPaddingFor(plotWidth)}
			props={{
				xAxis: { tickSpacing: xTickSpacingFor(plotWidth) },
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
