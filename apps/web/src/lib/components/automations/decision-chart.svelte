<script module lang="ts">
	/**
	 * One plotted series. Mark shape carries identity alongside hue — filled area
	 * for context measures, solid or dashed line for the rest — so the series stay
	 * distinguishable under colour-vision deficiency (dataviz accessibility pass).
	 */
	export type PlotSeries = {
		key: string;
		label: string;
		color: string;
		unit: string;
		/** Fill opacity under the line; line-only when omitted. */
		fill?: number;
		/** SVG dash pattern; solid when omitted. */
		dash?: string;
		width?: number;
	};

	/** Any row the chart can plot: a timestamp plus the values its series read. */
	export type ChartRow = { t: Date; [key: string]: unknown };

	/** A series' mark attributes, resolved once per series instead of per render. */
	function styleOf(s: PlotSeries) {
		return {
			fillOpacity: s.fill === undefined ? 0 : s.fill,
			line: {
				'stroke-width': s.width === undefined ? 2 : s.width,
				'stroke-dasharray': s.dash === undefined ? 'none' : s.dash
			}
		};
	}
</script>

<script lang="ts">
	// The shared plot behind both decision charts: same axes, hover and legend
	// treatment, only the series list and curve differ. Keeping one chart body
	// means kW and A never end up sharing a plot (no dual axis, ever).
	import { AreaChart, Area, ChartClipPath, Highlight } from 'layerchart';
	import * as Chart from '$lib/components/ui/chart';
	import { seriesConfig } from '$lib/components/inverter/_shared/chart-series';
	import ChartLegend from '$lib/components/inverter/chart-legend.svelte';
	import CustomChartTooltip from '$lib/components/inverter/custom-chart-tooltip.svelte';
	import { display } from '$lib/display.svelte';
	import type { CurveFactory } from 'd3-shape';
	import { CHART_BOX } from '$lib/layout/tokens';

	let {
		rows,
		series,
		curve,
		height = CHART_BOX,
		tooltipExtras = [],
		yDomain,
		layout = 'overlap'
	}: {
		rows: ChartRow[];
		series: PlotSeries[];
		curve: CurveFactory;
		/** Tailwind height class for the plot box (fixed height, not h-full). */
		height?: string;
		/** Rows shown on hover only, e.g. the measured counterpart of a series. */
		tooltipExtras?: PlotSeries[];
		/** Fixed y range; `null` as the max keeps it data-driven. */
		yDomain?: [number, number | null];
		/** `stack` for a part-to-whole decomposition, `overlap` for comparisons. */
		layout?: 'overlap' | 'stack';
	} = $props();

	type MarksContext = { context: { series: { visibleSeries: { key: string }[] } } };

	const markStyle = $derived(Object.fromEntries(series.map((s) => [s.key, styleOf(s)])));
	const plotSeries = $derived(
		series.map((s) => ({
			key: s.key,
			label: s.label,
			color: s.color,
			value: (d: ChartRow) => d[s.key] as number | null
		}))
	);
	const config: Chart.ChartConfig = $derived(seriesConfig(series));
	const tooltipSeries = $derived([...series, ...tooltipExtras]);

	const timeLabel = (value: unknown) => display.time(new Date(Number(value)));

	const boxClass = $derived(`aspect-auto w-full min-w-0 ${height}`);
</script>

<!-- Clipped to the plot area: a stacked total or a curve overshoot must stay
     inside the chart box instead of painting over the text around it. -->
{#snippet marks({ context }: MarksContext)}
	<ChartClipPath>
		{#each context.series.visibleSeries as s (s.key)}
			<Area seriesKey={s.key} {curve} {...markStyle[s.key]} />
		{/each}
		<Highlight points lines />
	</ChartClipPath>
{/snippet}

<div class="flex min-w-0 flex-col gap-3">
	<Chart.Container {config} class={boxClass}>
		<AreaChart
			data={rows}
			x="t"
			series={plotSeries}
			seriesLayout={layout}
			axis
			grid
			rule={false}
			legend={false}
			{yDomain}
			padding={{ top: 8, right: 8, bottom: 24, left: 44 }}
			props={{ xAxis: { format: timeLabel, ticks: 5 } }}
			{marks}
			highlight={false}
			tooltipContext={{ mode: 'bisect-x' }}
		>
			{#snippet tooltip()}
				<CustomChartTooltip series={tooltipSeries} labelFormatter={timeLabel} />
			{/snippet}
		</AreaChart>
	</Chart.Container>
	<ChartLegend items={series} />
</div>
