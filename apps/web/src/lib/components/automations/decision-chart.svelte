<script module lang="ts">
	import { houseLine, type ChartKind, type DashKind } from '$lib/charts/house-style';

	/**
	 * One plotted series. Mark shape carries identity alongside hue — filled area
	 * for context measures, solid or dashed line for the rest — so the series stay
	 * distinguishable under colour-vision deficiency (dataviz accessibility pass).
	 *
	 * The three optional fields are OVERRIDES of the chart's kind, each with a
	 * reason at the site that spends it. Everything else — the curve, the stroke
	 * weight, the two dash patterns — is the house table's.
	 */
	export type PlotSeries = {
		key: string;
		label: string;
		color: string;
		unit: string;
		/** Fill opacity under the line; the kind's default when omitted. */
		fill?: number;
		/** Dash by MEANING, not by pattern; solid when omitted. */
		dash?: DashKind;
		width?: number;
	};

	/** Any row the chart can plot: a timestamp plus the values its series read. */
	export type ChartRow = { t: Date; [key: string]: unknown };

	/** A series' mark attributes, resolved once per series instead of per render. */
	function styleOf(s: PlotSeries, kind: ChartKind) {
		return houseLine(kind, { dash: s.dash, strokeWidth: s.width, fillOpacity: s.fill });
	}
</script>

<script lang="ts">
	// The shared plot behind all four decision charts: same axes, hover and
	// legend treatment, only the series list and the KIND differ. Keeping one
	// chart body means kW and A never end up sharing a plot (no dual axis, ever).
	//
	// It used to take a `curve` factory, which is exactly how two of the four
	// ended up smoothed and one stepped with nobody deciding that: the caller
	// chose a spline. Now the caller says what it plots and
	// $lib/charts/house-style answers.
	import { AreaChart, Area, ChartClipPath, Highlight } from 'layerchart';
	import * as Chart from '$lib/components/ui/chart';
	import { seriesConfig } from '$lib/components/inverter/_shared/chart-series';
	import ChartLegend from '$lib/components/inverter/chart-legend.svelte';
	import CustomChartTooltip from '$lib/components/inverter/custom-chart-tooltip.svelte';
	import { display } from '$lib/display.svelte';
	import { fittedPadding } from '$lib/charts/plot-padding';
	import { CHART_BOX } from '$lib/layout/tokens';

	// The plot's own gutters: a kW/A figure on the left, a clock label's overhang
	// on the right. Its own base, not the cost family's — a decision chart plots
	// power, never a four-digit kWh total.
	const PADDING = { top: 8, right: 8, bottom: 24, left: 44 };

	let {
		rows,
		series,
		kind,
		height = CHART_BOX,
		tooltipExtras = [],
		yDomain,
		layout = 'overlap'
	}: {
		rows: ChartRow[];
		series: PlotSeries[];
		/** What these series ARE; decides the curve and the mark treatment. */
		kind: ChartKind;
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

	const markStyle = $derived(Object.fromEntries(series.map((s) => [s.key, styleOf(s, kind)])));
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

	// Measured, not inferred from a breakpoint: this chart renders one-up and
	// two-up on the same page depending on the column it lands in.
	let plotWidth = $state(0);

	const boxClass = $derived(`aspect-auto w-full min-w-0 ${height}`);
</script>

<!-- Clipped to the plot area: a stacked total or a curve overshoot must stay
     inside the chart box instead of painting over the text around it. -->
{#snippet marks({ context }: MarksContext)}
	<ChartClipPath>
		{#each context.series.visibleSeries as s (s.key)}
			<Area seriesKey={s.key} {...markStyle[s.key]} />
		{/each}
		<Highlight points lines />
	</ChartClipPath>
{/snippet}

<div class="flex min-w-0 flex-col gap-3" bind:clientWidth={plotWidth}>
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
			padding={fittedPadding(PADDING, plotWidth)}
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
