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
	import type { ChartState } from 'layerchart';
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
	import ZoomControls from '$lib/charts/zoom-controls.svelte';
	import { chartZoom } from '$lib/charts/zoom.svelte';
	import { bandIndexRange } from '$lib/charts/zoom-range';

	let {
		data,
		series,
		format,
		yDomain,
		onZoom,
		onResetZoom,
		zoomed = false
	}: {
		/** Rows in period order; `label` is the x-axis band. */
		data: Row[];
		series: (LabelledSeries & { value: (d: Row) => number | null })[];
		/** Renders one value for the axis and the tooltip. */
		format: (v: unknown) => string;
		/** Fixed y domain — ratios pin [0, 1]; kWh charts scale to their data. */
		yDomain?: [number, number];
		/**
		 * The POSITIONS a drag selected, not the labels: a 24-month axis repeats
		 * "Aug", so only the position identifies the period. The owner pairs them
		 * with the keys the rows were built from and refetches — a week out of a
		 * month comes back by hour (see zoomedChartSpec).
		 */
		onZoom?: (indices: [number, number]) => void;
		onResetZoom?: () => void;
		/** The owner's section is currently showing a zoomed spec. */
		zoomed?: boolean;
	} = $props();

	const config = $derived(seriesConfig(series));

	// The gutters follow the plot's MEASURED width, not a breakpoint: this chart
	// renders full-bleed on one page and inside a two-up grid on another, so only
	// the element knows how much room it got. 0 until it is in the document,
	// which chartPaddingFor reads as the desktop case.
	let plotWidth = $state(0);

	const labels = $derived(data.map((d) => d.label));

	const zoom = chartZoom({
		onSelect: (x) => {
			const indices = bandIndexRange(labels, x);
			if (indices) onZoom?.(indices);
		},
		onReset: () => onResetZoom?.()
	});
</script>

<!-- The chart context, taken where it is reachable. LayerChart's canvas
     wrappers do not re-export `context` as bindable, and the reset control has
     to reach the transform state to undo a gesture. `belowContext` renders
     outside the drawing layer, so capturing here adds no mark of its own. -->
{#snippet belowContext({ context }: { context: ChartState<Row> })}{zoom.capture(context)}{/snippet}

<div class="flex min-w-0 flex-col gap-3" bind:clientWidth={plotWidth}>
	<div class="relative">
		<ZoomControls {zoom} resettable={zoomed} />
		<Chart.Container {config} class="{CHART_BOX} w-full min-w-0">
			<LineChart
				{data}
				x="label"
				xScale={scalePoint()}
				{series}
				{yDomain}
				{...zoom.props}
				{belowContext}
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
	</div>
	<ChartLegend items={series} />
</div>
