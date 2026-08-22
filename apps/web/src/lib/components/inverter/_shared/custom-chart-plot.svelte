<script lang="ts">
	// The HISTORICAL plot of an overlaid chart, in whichever of its two forms
	// applies: dual-axis when the series span more than one unit (marks drawn by
	// hand so each axis keeps its real values while the series share a
	// normalized [0,1] scale), otherwise LayerChart's plain filled area on one
	// axis.
	//
	// The gliding live window is `CustomLiveChart`, chosen by the caller. It used
	// to be a third branch in here, and having it meant every gesture and every
	// control had to be guarded against a form that owns a transform of its own.
	import { AreaChart, Area, Axis, Highlight, type ChartState } from 'layerchart';
	import { houseLine } from '$lib/charts/house-style';
	import * as Chart from '$lib/components/ui/chart';
	import DualYAxes from '$lib/components/inverter/_shared/dual-y-axes.svelte';
	import CustomChartTooltip from '$lib/components/inverter/custom-chart-tooltip.svelte';
	import type { ResolvedAxes } from '$lib/components/inverter/_shared/chart-series';
	import ZoomControls from '$lib/charts/zoom-controls.svelte';
	import PlotFrame from '$lib/components/layout/plot-frame.svelte';
	import { historyZoom } from '$lib/charts/zoom.svelte';
	import { fittedPadding } from '$lib/charts/plot-padding';
	import type { HistoryRange, RollupBucket } from '$lib/inverter/ranges';
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
		data,
		series,
		config,
		axes,
		xDomain,
		labelFormatter,
		xTickFormat,
		bucket,
		onZoom,
		onResetZoom,
		zoomed = false
	}: {
		data: Datum[];
		series: AxisSeries[];
		config: Chart.ChartConfig;
		axes: ResolvedAxes;
		/** The whole selected window, so a partial day still spans the full range. */
		xDomain: [Date, Date];
		labelFormatter: (v: unknown) => string;
		xTickFormat: (v: unknown) => string;
		/** Rollup the plotted rows were fetched at; sets the mis-tap floor. */
		bucket: RollupBucket;
		/**
		 * A drag-selected window, already resolved to a range. The owner answers
		 * by REFETCHING it, exactly as the single-metric card does — magnifying
		 * the coarse buckets already on screen would show nothing new.
		 */
		onZoom?: (range: HistoryRange) => void;
		onResetZoom?: () => void;
		/** The owner is currently showing a zoomed window. */
		zoomed?: boolean;
	} = $props();

	// One controller for both historical forms — only one of them renders at a
	// time. The live form is deliberately left out: it already runs a transform
	// of its own inside a ChartClipPath to glide the window, and a second one
	// composes badly (see apps/web/DESIGN.md, "Gestures on a chart").
	// Every field is a closure, deliberately: a prop passed by value here would
	// capture whatever it was on the first render, and the page reassigns these
	// handlers as its range changes.
	const zoom = historyZoom({
		bucket: () => bucket,
		onZoom: (range) => onZoom?.(range),
		onResetZoom: () => onResetZoom?.()
	});

	// AreaChart's `marks` context isn't exposed in the public types; type just the
	// fields the dual-axis marks snippet reads.
	type MarksContext = {
		context: { height: number; series: { visibleSeries: { key: string }[] } };
	};
</script>

<!-- The chart context, taken where it is reachable: LayerChart's canvas
     wrappers do not re-export `context` as bindable, and the reset control has
     to reach the transform state to undo a gesture. -->
{#snippet belowContext({ context }: { context: ChartState<Datum> })}{zoom.capture(context)}{/snippet}

<!--
	The dual-axis form draws its own y axes, and it has to do it from the `axis`
	slot rather than from `marks`. LayerChart wraps `marks` in a ChartClipPath
	the moment a chart carries a brush or a `domain` transform — which every
	zoomable chart does — and these labels live in the padding gutter, OUTSIDE
	the plot rect. Drawn among the marks they are simply clipped away: the series
	still render and the axes silently vanish.
-->
{#snippet dualAxes({ context }: MarksContext)}
	<Axis placement="bottom" format={xTickFormat} ticks={4} />
	<DualYAxes height={context.height} {axes} />
{/snippet}

<!-- One measuring box around both forms: the plot is the same box whichever
     branch renders, and measuring per-branch would re-measure on every switch.
     It stays an element of its own rather than becoming PlotFrame: the frame owns
     its inner div, so `bind:clientWidth` cannot ride on it, and the binding has to
     keep reading the plot's box. Same box either way — this element is what sizes
     the frame — and the height is still the card's, since EXPANDED_SECTION's
     `*:has([data-slot=chart])` chain claims every ancestor of the plot, this one
     included. `relative` moved with the controls: it is PlotFrame's box the
     corners resolve against now. -->
<div class="h-full w-full" bind:clientWidth={plotWidth}>
	<PlotFrame>
		{#snippet chips()}
			<!-- The transient top-right corner: ZoomControls positions itself
			     absolutely, so it needs PlotFrame's `relative` box. -->
			<ZoomControls {zoom} resettable={zoomed} />
		{/snippet}
		{#if axes.grouping.dualAxis}
			<Chart.Container {config} class="aspect-auto h-full w-full">
				<AreaChart
					{data}
					x="date"
					series={axes.plotSeries}
					{xDomain}
					yDomain={[0, 1]}
					seriesLayout="overlap"
					axis={dualAxes}
					grid={false}
					highlight={false}
					padding={fittedPadding(DUAL_AXIS_PADDING, plotWidth, { rightAxis: true })}
					{...zoom.props}
					{belowContext}
				>
					{#snippet marks({ context }: MarksContext)}
						<!-- `overlay`: several measures compared, so a stroke and no fill
						     ($lib/charts/house-style). Two translucent fills over each
						     other mix into a third colour belonging to neither series. -->
						{#each context.series.visibleSeries as s (s.key)}
							<Area seriesKey={s.key} {...houseLine('overlay')} />
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
					{...zoom.props}
					{belowContext}
					props={{
						area: houseLine('overlay'),
						xAxis: { format: xTickFormat, ticks: 4 }
					}}
				>
					{#snippet tooltip()}
						<CustomChartTooltip {series} {labelFormatter} />
					{/snippet}
				</AreaChart>
			</Chart.Container>
		{/if}
	</PlotFrame>
</div>
