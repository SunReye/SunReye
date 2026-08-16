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
	import type { HistoryRange, RollupBucket } from '$lib/inverter/ranges';
	import type { Snippet } from 'svelte';

	let {
		data,
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

<div class="relative h-full w-full">
	<ZoomControls {zoom} resettable={zoomed} />
	<Chart.Container
		config={{ avg: { label, color: accent } }}
		class="aspect-auto h-full w-full"
		style="--color-primary: {accent}"
	>
		<AreaChart
			{data}
			x="date"
			y="avg"
			axis
			grid
			padding={{ top: 8, right: 8, bottom: 28, left: 44 }}
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
</div>
