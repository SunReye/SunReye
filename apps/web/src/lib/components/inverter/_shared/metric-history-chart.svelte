<script lang="ts">
	// The historical area chart of a single metric. Signed metrics (battery/grid
	// power) split the fill red above / green below a zero baseline; unsigned ones
	// get a vertical gradient fading to transparent.
	import { AreaChart, Area, LinearGradient, type ChartState } from 'layerchart';
	import { curveCatmullRom } from 'd3-shape';
	import * as Chart from '$lib/components/ui/chart';
	import DivergingArea from '$lib/components/inverter/diverging-area.svelte';
	import ZoomControls from '$lib/charts/zoom-controls.svelte';
	import { chartZoom, zoomLabelOptions } from '$lib/charts/zoom.svelte';
	import { minExtentFor, zoomedHistoryRangeFrom } from '$lib/charts/zoom-range';
	import { fittedPadding, shouldRenderPlot } from '$lib/charts/plot-padding';
	import { downsample, pointBudget } from '$lib/components/inverter/_shared/downsample';
	import type { HistoryRange, RollupBucket } from '$lib/inverter/ranges';
	import type { Snippet } from 'svelte';

	let {
		data,
		maxPoints,
		label,
		accent,
		diverging,
		xDomain,
		bucket,
		xTickFormat,
		labelFormatter,
		tooltipValue,
		onZoom,
		onResetZoom,
		zoomed = false
	}: {
		/** Rollup rows carrying `date` and `avg`. */
		data: { date: Date; avg: number }[];
		/**
		 * Rows to draw at most. Defaults to the MEASURED plot's own pixel budget
		 * — a preset range hands a ~450px card ~1876 rows, and the ones past
		 * roughly one per device pixel cost path construction to produce a
		 * sub-pixel wobble. A caller with a bigger plot (or a reason to keep the
		 * lot) states its own; `Infinity` disables the reduction.
		 */
		maxPoints?: number;
		label: string;
		accent: string;
		diverging: boolean;
		xDomain: [Date, Date];
		/** Rollup the plotted rows were fetched at; sets the mis-tap floor. */
		bucket: RollupBucket;
		xTickFormat: (v: unknown) => string;
		labelFormatter: (v: unknown) => string;
		/** Tooltip row for the hovered value. */
		tooltipValue: Snippet<[{ value: unknown }]>;
		/**
		 * A drag-selected window, already resolved to a range. The owner answers by
		 * REFETCHING it — twenty minutes out of an hourly window comes back as
		 * minute rollups, which is the whole point of the gesture; magnifying the
		 * four bars already on screen would show nothing new.
		 */
		onZoom?: (range: HistoryRange) => void;
		onResetZoom?: () => void;
		/** The owner is currently showing a zoomed window. */
		zoomed?: boolean;
	} = $props();

	type MarksContext = {
		context: { yScale: (v: number) => number; height: number; padding: { bottom: number } };
	};

	// This chart's own gutters: a signed power figure on the left, a time label's
	// overhang on the right. Its base, clamped on a phone — the /history cards go
	// full-bleed at 412px, where 44px is a tenth of the plot.
	const PADDING = { top: 8, right: 8, bottom: 28, left: 44 };

	// Measured rather than guessed from a breakpoint: the same card renders
	// one-up on a phone and three-up in the history grid.
	let plotWidth = $state(0);

	// Device pixels per CSS pixel, read once — a dpr change (browser zoom,
	// monitor swap) only widens the row budget below, never invalidates a
	// series already drawn at the coarser one.
	const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio;

	// The rows this plot can actually resolve. A preset range returns ~1876 of
	// them per card and ~270ms of the measured 278ms mount was d3 turning those
	// into path data; LTTB keeps the spikes that make the chart worth opening.
	// Derived from the plot width, so it only ever runs on a measured box.
	const plotted = $derived(
		downsample(data, maxPoints ?? pointBudget(plotWidth, dpr), {
			x: (row) => row.date.getTime(),
			y: (row) => row.avg
		})
	);

	// The selection floor is two of whatever bucket is on screen: on a 5-minute
	// window a one-minute drag is a fingertip's width, and a mis-tap that
	// refetches every card on the page is worse than no gesture at all.
	const zoom = chartZoom({
		minExtent: () => minExtentFor(bucket),
		onSelect: (x) => {
			const range = zoomedHistoryRangeFrom(x, zoomLabelOptions());
			if (range) onZoom?.(range);
		},
		onReset: () => onResetZoom?.()
	});
</script>

<!-- The chart context, taken where it is reachable. LayerChart's canvas
     wrappers do not re-export `context` as bindable, and the reset control has
     to reach the transform state to undo a gesture. `belowContext` renders
     outside the drawing layer, so capturing here adds no mark of its own. -->
{#snippet belowContext({ context }: { context: ChartState<{ date: Date; avg: number }> })}{zoom.capture(context)}{/snippet}

<!-- The plot waits one frame for `bind:clientWidth` to land — see
     `shouldRenderPlot`. Without the gate every scale, tick, grid line, spline
     and area path is built once at width 0 and then rebuilt at the real width
     the moment the fitted padding changes, which was the largest multiplier
     inside the measured per-mount cost. The wrapper keeps its own height, so
     the skipped frame shifts nothing. -->
<div class="relative h-full w-full" bind:clientWidth={plotWidth}>
	<ZoomControls {zoom} resettable={zoomed} />
	{#if shouldRenderPlot(plotWidth)}
		<Chart.Container
			config={{ avg: { label, color: accent } }}
			class="aspect-auto h-full w-full"
			style="--color-primary: {accent}"
		>
			<AreaChart
				data={plotted}
				x="date"
				y="avg"
				axis
				grid
				padding={fittedPadding(PADDING, plotWidth)}
				{xDomain}
				{...zoom.props}
				{belowContext}
				props={{ xAxis: { format: xTickFormat, ticks: 4 } }}
			>
				{#snippet marks({ context }: MarksContext)}
					{#if diverging}
						<DivergingArea {context} />
					{:else}
						<LinearGradient vertical stops={[[0, accent], [1, 'transparent']]}>
							{#snippet children({ gradient })}
								<Area
									curve={curveCatmullRom}
									line={{ stroke: accent, 'stroke-width': 1.5 }}
									fill={gradient}
									fillOpacity={0.9}
								/>
							{/snippet}
						</LinearGradient>
					{/if}
				{/snippet}
				{#snippet tooltip()}
					<Chart.Tooltip {labelFormatter} formatter={tooltipValue} />
				{/snippet}
			</AreaChart>
		</Chart.Container>
	{/if}
</div>
