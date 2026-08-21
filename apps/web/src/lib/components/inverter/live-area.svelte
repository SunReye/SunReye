<script lang="ts">
	import { AreaChart, ChartClipPath, Highlight } from 'layerchart';
	import DivergingArea from '$lib/components/inverter/diverging-area.svelte';
	import PowerArea from '$lib/components/inverter/power-area.svelte';
	import * as Chart from '$lib/components/ui/chart';
	import MetricTooltipRow from '$lib/components/inverter/_shared/metric-tooltip-row.svelte';
	import { liveCursor } from '$lib/components/inverter/_shared/live-cursor.svelte';
	import {
		bufferStart,
		glideTransform,
		pixelQuantum,
		sampleInterval
	} from '$lib/components/inverter/_shared/live-window';
	import { display } from '$lib/display.svelte';
	import { fittedPadding, shouldRenderPlot } from '$lib/charts/plot-padding';
	import { downsample, pointBudget } from '$lib/components/inverter/_shared/downsample';
	import type { LivePoint } from '$lib/inverter/types';

	// The sparkline's own gutters: a power figure on the left, no x-axis at all,
	// so top/bottom/right are hairlines. Its own base — the cost family's 60px
	// left gutter would be a third of a 412px live card.
	const PADDING = { top: 6, bottom: 6, left: 44, right: 6 };

	// Step grid the glide snaps to — see `pixelQuantum`. Read once: a dpr change
	// (browser zoom, monitor swap) only alters the step size, never the position,
	// so a stale value is harmless.
	const quantum = pixelQuantum(typeof window === 'undefined' ? 1 : window.devicePixelRatio);

	let {
		points = [],
		accent = 'var(--chart-2)',
		diverging = false,
		windowMs = 2 * 60 * 1000,
		height = 'h-40',
		label = 'Value',
		unit = '',
		maxPoints
	}: {
		points?: LivePoint[];
		accent?: string;
		/** Split the fill red (above 0) / green (below 0) around a zero baseline. */
		diverging?: boolean;
		windowMs?: number;
		/** Tailwind height class for the chart box; `h-full` to fill the caller's box. */
		height?: string;
		/** Series name shown in the hover tooltip. */
		label?: string;
		/** Unit suffix appended to the tooltip value. */
		unit?: string;
		/**
		 * Samples to draw at most, after the window filter. Defaults to the
		 * MEASURED plot's own pixel budget; a caller with a wider box (the
		 * overview's sparklines) states its own, and `Infinity` keeps every
		 * sample the window holds.
		 */
		maxPoints?: number;
	} = $props();

	// AreaChart's `marks` context isn't exposed in the public types; type just the
	// fields we read so it isn't implicitly `any`.
	type MarksContext = {
		context: {
			xScale: (value: number) => number;
			yScale: (value: number) => number;
			height: number;
			padding: { bottom: number };
		};
	};

	const lastT = $derived(points.at(-1)?.t);

	// Spacing between samples, clamped, used to size the off-screen buffer below.
	const interval = $derived(sampleInterval(points.at(-1)?.t, points.at(-2)?.t));

	// The glide cursor the marks below scroll by — shared with custom-live-chart,
	// see _shared/live-cursor.svelte.ts for why it trails the newest sample.
	const cursor = liveCursor(
		() => lastT,
		() => interval
	);

	// Fixed window anchored to the newest sample, with an off-screen buffer past the
	// left edge — see _shared/live-window.ts for why.
	const xDomain = $derived(lastT === undefined ? undefined : [lastT - windowMs, lastT]);
	const cutoff = $derived(lastT === undefined ? -Infinity : bufferStart(lastT, windowMs, interval));

	// Fitted to the MEASURED plot: these cards render one-up on a phone and four
	// across the overview, so no breakpoint knows how wide this one got.
	let plotWidth = $state(0);
	const padding = $derived(fittedPadding(PADDING, plotWidth));

	// The window filter above decides which samples are IN FRAME; this decides
	// how many of those the frame can resolve — one per device pixel, LTTB so a
	// one-sample spike survives the reduction instead of being strided away. A
	// two-minute live window rarely reaches the budget, so this normally hands
	// back the filtered series untouched; a slow feed backfilled over a long
	// window is what it is here for.
	const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
	const data = $derived(
		downsample(
			points.filter((p) => p.t >= cutoff),
			maxPoints ?? pointBudget(plotWidth, dpr),
			{ x: (p) => p.t, y: (p) => p.v }
		)
	);

	// The edge fade has to start where the axis-label gutter ENDS, so it follows
	// the fitted left gutter instead of repeating 44px: clamped to 34px on a
	// phone, a fade pinned at 44 would eat the first 10px of the plotted line.
	const edgeFade = $derived(
		`linear-gradient(to right, #000 0, #000 ${padding.left - 2}px, transparent ${padding.left}px, #000 ${padding.left + 52}px, #000 calc(100% - 58px), transparent calc(100% - 6px))`
	);
</script>

{#snippet clippedMarks({ context }: MarksContext)}
	<!-- The SVG transform attribute, snapped to a quarter-pixel grid: the string is
	     identical on the four frames in five that move less than a quarter pixel, so
	     Svelte's `!==` equality drops the write, and with it the style invalidation,
	     paint and raster it would have cost. -->
	{@const glide = glideTransform(context.xScale, lastT, cursor.current, interval, quantum)}
	<ChartClipPath>
		<g transform={glide}>
			{#if diverging}
				<DivergingArea {context} />
			{:else}
				<!-- `power`: one instantaneous measure, so the house fill is the accent
				     fading downward to transparent. It used to be a flat 0.3 wash here
				     and a 0.9 gradient on the history card, which read as two different
				     measures; the SAME component draws both now, so they cannot drift
				     apart again. -->
				<PowerArea {accent} />
			{/if}
			<!-- Render the hover highlight INSIDE the glide-translated group so the
			     point/crosshair track the visible line. The chart's built-in highlight
			     (disabled below) positions in untranslated data space and would sit
			     offset from the line by exactly `glideX`. -->
			<Highlight points lines />
		</g>
	</ChartClipPath>
{/snippet}

<!-- A measuring box around the plot: the chart container is layerchart's own
     fixed-size element, so the width the gutters follow is read here.
     `h-full` and not `w-full` alone: /history hands this component `h-full`,
     which resolves against THIS div — an unsized wrapper made every live chart
     on that page render at 0px. -->
<div class="h-full w-full" bind:clientWidth={plotWidth}>
	{#if !shouldRenderPlot(plotWidth)}
		<!-- One frame, before `bind:clientWidth` lands. Rendering the plot here
		     would build every scale, tick, grid line and area path at width 0 and
		     throw all of it away when the fitted padding changed a frame later.
		     The spacer carries the caller's own height class so the box the chart
		     is about to fill is already the right size and nothing shifts. -->
		<div class={['w-full', height]} aria-hidden="true"></div>
	{:else}
		<Chart.Container
			config={{ v: { label, color: accent } }}
			class={[
				'aspect-auto w-full',
				height,
				// Feather the plot's horizontal edges so data glides in/out instead of ending on
				// a hard cut. The mask is pinned to layerchart's fixed-size container (not the
				// moving data path) so the fade stays put while the series scrolls under it. The
				// gradient keeps the left axis-label gutter opaque and feathers only inside the
				// plot area — see `edgeFade`, which follows that gutter's fitted width.
				'[&_.lc-root-container]:mask-(--edge-fade)'
			]}
			style="--color-primary: {accent}; --edge-fade: {edgeFade}"
		>
			<!--
				`tooltipContext` mode: the default `quadtree-x` rebuilds a d3-quadtree (async
				import + full re-index) on every sample — with a 1 Hz feed and 4 always-on
				sparklines that allocation dominated the heap. `bisect-x` allocates nothing per
				sample (it binary-searches the sorted series at pointer-move) and gives the same
				nearest-x hover.
			-->
			<AreaChart
				{data}
				x="t"
				{xDomain}
				y="v"
				axis="y"
				grid
				rule={false}
				legend={false}
				padding={padding}
				marks={clippedMarks}
				highlight={false}
				tooltipContext={{ mode: 'bisect-x' }}
			>
				{#snippet tooltip()}
					<Chart.Tooltip
						labelFormatter={(value) => display.timeWithSeconds(new Date(Number(value)))}
						formatter={tooltipValue}
					/>
				{/snippet}
			</AreaChart>
		</Chart.Container>
	{/if}
</div>

{#snippet tooltipValue({ value }: { value: unknown })}
	<MetricTooltipRow {label} {value} {unit} />
{/snippet}
