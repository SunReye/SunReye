<script lang="ts">
	import { AreaChart, Area, ChartClipPath, Highlight } from 'layerchart';
	import { curveCatmullRom } from 'd3-shape';
	import { untrack } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { linear } from 'svelte/easing';
	import * as Chart from '$lib/components/ui/chart';
	import DualYAxes from '$lib/components/inverter/_shared/dual-y-axes.svelte';
	import CustomChartTooltip from '$lib/components/inverter/custom-chart-tooltip.svelte';
	import { resolveAxes } from '$lib/components/inverter/_shared/chart-series';
	import {
		bufferStart,
		glideOffset,
		sampleInterval
	} from '$lib/components/inverter/_shared/live-window';
	import type { AxisSeries, Datum } from '$lib/inverter/chart-axes';

	let {
		data = [],
		series,
		config,
		labelFormatter,
		windowMs = 2 * 60 * 1000
	}: {
		/** Merged rows, one per timestamp: `{ date: Date, [metricKey]: number }`. */
		data?: Datum[];
		/** Overlaid series definitions (key/label/color/unit/value), shared by the chart. */
		series: AxisSeries[];
		config: Chart.ChartConfig;
		labelFormatter: (value: unknown) => string;
		windowMs?: number;
	} = $props();

	// AreaChart's `marks` context isn't exposed in the public types; type just the
	// fields we read so it isn't implicitly `any`.
	type MarksContext = {
		context: {
			xScale: (value: number) => number;
			height: number;
			series: { visibleSeries: { key: string }[] };
		};
	};

	const times = $derived(data.map((d) => (d.date as Date).getTime()));
	const lastT = $derived(times.at(-1));

	// Spacing between samples, clamped, used to size the off-screen buffer below.
	const interval = $derived(sampleInterval(times.at(-1), times.at(-2)));

	// Fixed window anchored to the newest sample, with an off-screen buffer past the
	// left edge — see _shared/live-window.ts for why.
	const xDomain = $derived(
		lastT === undefined ? undefined : [new Date(lastT - windowMs), new Date(lastT)]
	);
	const cutoff = $derived(lastT === undefined ? -Infinity : bufferStart(lastT, windowMs, interval));
	const windowed = $derived(data.filter((d) => (d.date as Date).getTime() >= cutoff));

	// Split by unit; a second unit means an independent right axis, and every series
	// plots against a normalized [0,1] scale so both real axes stay aligned.
	const axes = $derived(resolveAxes(windowed, series));
	const dualAxis = $derived(axes.grouping.dualAxis);
	const fillOpacity = $derived(dualAxis ? 0 : 0.2);

	// With two axes the chart's own y-axis/grid step aside for the real-valued left and
	// right axes drawn in `marks`, and the right gutter widens to fit their labels.
	const scaleProps = $derived(
		dualAxis
			? {
					yDomain: [0, 1],
					axis: false as const,
					grid: false,
					padding: { top: 8, right: 44, bottom: 6, left: 44 }
				}
			: {
					yDomain: undefined,
					axis: 'y' as const,
					grid: true,
					padding: { top: 8, right: 6, bottom: 6, left: 44 }
				}
	);

	// A real-time cursor that drifts continuously toward the newest sample instead of
	// snapping to it once a second. Only the marks' translate (below) reads `cursor` —
	// never `data`/`xDomain` — so the chart itself does NOT re-render per frame. Mirrors
	// live-area.svelte; here the marks group holds every overlaid series.
	const cursor = new Tween(untrack(() => lastT) ?? 0);
	let lastAt = performance.now();
	$effect(() => {
		const t = lastT; // track live updates
		if (t === undefined) return;
		const now = performance.now();
		const gap = now - lastAt;
		lastAt = now;
		void cursor.set(t, { duration: Math.min(2000, Math.max(300, gap)), easing: linear });
	});

	// Keep the right axis gutter opaque too when a second axis is present.
	const edgeFade = $derived(
		dualAxis
			? 'linear-gradient(to right, #000 0, #000 42px, transparent 44px, #000 96px, #000 calc(100% - 96px), transparent calc(100% - 46px), #000 calc(100% - 44px))'
			: 'linear-gradient(to right, #000 0, #000 42px, transparent 44px, #000 96px, #000 calc(100% - 20px), transparent calc(100% - 6px))'
	);
</script>

{#snippet clippedMarks({ context }: MarksContext)}
	{#if dualAxis}
		<DualYAxes height={context.height} {axes} />
	{/if}
	<ChartClipPath>
		<g transform={`translate(${glideOffset(context.xScale, lastT, cursor.current, interval)}, 0)`}>
			{#each context.series.visibleSeries as s (s.key)}
				<Area seriesKey={s.key} curve={curveCatmullRom} {fillOpacity} line={{ 'stroke-width': 1.5 }} />
			{/each}
			<!-- Highlight inside the glide-translated group so the point/crosshair track
			     the visible line (the chart's own highlight sits in untranslated data
			     space, offset by exactly the glide offset). -->
			<Highlight points lines />
		</g>
	</ChartClipPath>
{/snippet}

<Chart.Container
	{config}
	class={[
		'aspect-auto h-full w-full',
		// Feather the plot's horizontal edges so data glides in/out instead of ending on
		// a hard cut. Pinned to layerchart's fixed-size container (not the moving path)
		// so the fade stays put while the series scrolls under it; keeps the axis-label
		// gutters opaque.
		'[&_.lc-root-container]:mask-(--edge-fade)'
	]}
	style="--edge-fade: {edgeFade}"
>
	<!--
		`bisect-x` tooltip mode allocates nothing per sample (binary-search on pointer
		move) vs the default `quadtree-x` rebuilding a quadtree every sample. Same
		nearest-x hover across the overlaid series.
	-->
	<AreaChart
		data={windowed}
		x="date"
		series={axes.plotSeries}
		{xDomain}
		{...scaleProps}
		seriesLayout="overlap"
		rule={false}
		legend={false}
		marks={clippedMarks}
		highlight={false}
		tooltipContext={{ mode: 'bisect-x' }}
	>
		{#snippet tooltip()}
			<CustomChartTooltip {series} {labelFormatter} />
		{/snippet}
	</AreaChart>
</Chart.Container>
