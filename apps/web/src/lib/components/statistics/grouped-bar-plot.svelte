<script lang="ts" generics="Row extends { label: string }">
	// The GROUPED BAR MARK, once.
	//
	// Two statistics charts draw it — the period series when its `kind` accrues
	// over the bucket, and the year-over-year pair — and everything around the
	// mark was identical in both: the canvas highlight, the zoom gesture, the
	// context capture that the reset control needs, and the tooltip. That
	// identical tail was the app's longest remaining clone group, the same way
	// `canvas-highlight.svelte.ts` describes for the wash it owns.
	//
	// What stays with the callers is what actually differs: the box (`CHART_BOX`
	// on their own `Chart.Container`), the card and its full-screen offer
	// (`PlotFrame`), the legend, and whether there is a y domain to pin at all.
	import { BarChart } from 'layerchart/canvas';
	import type { ChartState } from 'layerchart';
	import SeriesTooltip from './series-tooltip.svelte';
	import type { ChartZoom } from '$lib/charts/zoom.svelte';
	import type { canvasHighlight } from '$lib/components/inverter/_shared/canvas-highlight.svelte';
	import type { LabelledSeries } from '$lib/components/inverter/_shared/chart-series';

	let {
		data,
		series,
		format,
		layout,
		yDomain,
		highlight,
		zoom
	}: {
		/** Rows in period order; `label` is the x-axis band. */
		data: Row[];
		/**
		 * Series to plot. `value` is optional and must be OMITTED here: LayerChart
		 * positions a grouped series with `x1 = series.value ?? series.key`, so an
		 * accessor function is handed to a band scale as its lookup key and every
		 * bar lands at NaN — nothing renders and nothing errors.
		 */
		series: (LabelledSeries & { value?: (d: Row) => number | null })[];
		/** Renders one value for the tooltip. */
		format: (v: number) => string;
		/**
		 * The grouped-bar layout spread: what `groupedBarProps` returns, plus
		 * whatever axis formatter the caller adds to it. It stays the caller's
		 * because the band fractions and the gutters follow the caller's own
		 * MEASURED plot width, which only the caller's element knows.
		 */
		layout: Record<string, unknown>;
		/** Fixed y domain, when the caller has one to pin. */
		yDomain?: [number, number];
		/** The caller's canvas highlight — its element is the caller's own box. */
		highlight: ReturnType<typeof canvasHighlight>;
		/** The caller's zoom: this renders the capture snippet it needs. */
		zoom: ChartZoom;
	} = $props();
</script>

<!-- The chart context, taken where it is reachable. LayerChart's canvas
     wrappers do not re-export `context` as bindable, and the reset control has
     to reach the transform state to undo a gesture. `belowContext` renders
     outside the drawing layer, so capturing here adds no mark of its own. -->
{#snippet belowContext({ context }: { context: ChartState<Row> })}{zoom.capture(context)}{/snippet}

<BarChart
	{data}
	x="label"
	{series}
	seriesLayout="group"
	{yDomain}
	{...layout}
	highlight={highlight.props}
	{...zoom.props}
	{belowContext}
>
	{#snippet tooltip()}
		<SeriesTooltip {format} />
	{/snippet}
</BarChart>
