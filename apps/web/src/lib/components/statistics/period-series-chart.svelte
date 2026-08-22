<script lang="ts" generics="Row extends { label: string }">
	// The statistics page's period-series shell: one canvas chart over a series of
	// periods, with the house Chart.Container + seriesConfig + ChartLegend trio
	// and a value-formatted tooltip. Every period chart on the page renders
	// through this, so they stay pixel-identical and only differ in the series
	// they build — and in the one thing that must differ, the MARK.
	//
	// The mark is not this file's choice and not the caller's: it follows the
	// `kind` the caller declares, through $lib/charts/house-style. kWh accrued
	// over a bucket is drawn as bars, because a line between two bucket totals
	// paints a rate the data does not carry; two shares that vary continuously
	// are drawn as a line. Same shell, same gutters, same tooltip.
	//
	// Canvas render context: a year window is hundreds of points across up to six
	// series, far past the band count where the SVG context freezes weak devices
	// (see forecast-chart.svelte).
	import { BarChart, LineChart } from 'layerchart/canvas';
	import type { ChartState } from 'layerchart';
	import { scalePoint } from 'd3-scale';
	import * as Chart from '$lib/components/ui/chart';
	import ChartLegend from '$lib/components/inverter/chart-legend.svelte';
	import SeriesTooltip from './series-tooltip.svelte';
	import {
		groupedBarProps,
		seriesConfig,
		type LabelledSeries
	} from '$lib/components/inverter/_shared/chart-series';
	import { canvasHighlight } from '$lib/components/inverter/_shared/canvas-highlight.svelte';
	import { CURVE, MARK_STYLE, type ChartKind } from '$lib/charts/house-style';
	import { chartPaddingFor, xTickSpacingFor } from '$lib/cost/ranges';
	import { CHART_BOX } from '$lib/layout/tokens';
	import PlotFrame from '$lib/components/layout/plot-frame.svelte';
	import { chartZoom } from '$lib/charts/zoom.svelte';
	import { bandIndexRange } from '$lib/charts/zoom-range';

	let {
		data,
		series,
		kind,
		format,
		yDomain,
		onZoom,
		onResetZoom,
		zoomed = false
	}: {
		/** Rows in period order; `label` is the x-axis band. */
		data: Row[];
		/**
		 * Series to plot. `value` is optional and must be OMITTED for a `kind`
		 * drawn as grouped bars: LayerChart positions a grouped series with
		 * `x1 = series.value ?? series.key`, so an accessor function is handed to
		 * a band scale as its lookup key and every bar lands at NaN — nothing
		 * renders and nothing errors. Naming the row field as the key keeps the
		 * lookup a string, and leaves a gap null rather than a zero bar.
		 */
		series: (LabelledSeries & { value?: (d: Row) => number | null })[];
		/** What these periods CARRY; decides the mark ($lib/charts/house-style). */
		kind: ChartKind;
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

	// Bars or a line, decided by what the data is rather than by which wrapper
	// imported this file.
	const bars = $derived(MARK_STYLE[kind].mark === 'bars');

	// Canvas can't read the `.lc-highlight-area` wash off CSS; without a concrete
	// colour the hovered band gets an opaque slab over it.
	const highlight = canvasHighlight();

	// The grouped-bar layout, plus the value axis' own formatter — the shared
	// helper owns the band fractions and the gutters, this adds the one prop that
	// belongs to the series rather than to the layout.
	const barProps = $derived.by(() => {
		const base = groupedBarProps(data.length, plotWidth);
		return { ...base, props: { ...base.props, yAxis: { format } } };
	});

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

<div class="flex min-w-0 flex-col gap-3" bind:this={highlight.el} bind:clientWidth={plotWidth}>
	<!-- The plot's own box: `PlotFrame` is the `relative` ancestor the zoom chips
	     have always positioned against, and it is also what draws full screen in
	     the opposite corner. The height stays the container's (`CHART_BOX`) — the
	     frame adds no box of its own. -->
	<PlotFrame {zoom} resettable={zoomed}>
		<Chart.Container {config} class="{CHART_BOX} w-full min-w-0">
			{#if bars}
				<!-- A quantity that belongs to the bucket: one bar per period per
				     series, grouped so the periods stay comparable. -->
				<BarChart
					{data}
					x="label"
					{series}
					seriesLayout="group"
					{yDomain}
					{...barProps}
					highlight={highlight.props}
					{...zoom.props}
					{belowContext}
				>
					{#snippet tooltip()}
						<SeriesTooltip {format} />
					{/snippet}
				</BarChart>
			{:else}
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
						spline: {
							// The house curve for the kind ($lib/charts/house-style). Left to
							// LayerChart this line was the app's only unsmoothed one, beside
							// four smoothed plots of the same shape.
							curve: CURVE[kind],
							// A line is a stroke, never a fill — but the `fill: none` default for
							// `.lc-path` ships in LayerChart's *SVG* Path component, which a
							// canvas-only import never pulls in. Without this the renderer reads
							// the initial `fill: black` off its style probe and floods the area
							// the polyline encloses.
							fill: 'none',
							// The house weight, for the same reason. A canvas mark that is
							// handed none is drawn at whatever the `.lc-path` probe resolves
							// (measured: 1px, the grid's weight), so the two ratio lines came
							// out as heavy as the gridlines behind them while the rest of the
							// app strokes at 1.5. Measured in e2e/chart-house-style.spec.ts.
							strokeWidth: MARK_STYLE[kind].strokeWidth
						}
					}}
				>
					{#snippet tooltip()}
						<SeriesTooltip {format} />
					{/snippet}
				</LineChart>
			{/if}
		</Chart.Container>
	</PlotFrame>
	<ChartLegend items={series} />
</div>
