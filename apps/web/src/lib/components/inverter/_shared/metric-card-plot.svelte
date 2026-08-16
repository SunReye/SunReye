<script lang="ts">
	// Which chart a history card draws, of the four it can: a draft overlay, the
	// gliding live sparkline, the historical rollup, or a loading/empty state.
	//
	// Its own file because the card's template branched five ways once drafting
	// joined the other three, and the branch has nothing to do with the card's
	// header, its lazy mount or its draft bookkeeping.
	import type { Snippet } from 'svelte';
	import LiveArea from '$lib/components/inverter/live-area.svelte';
	import MetricHistoryChart from '$lib/components/inverter/_shared/metric-history-chart.svelte';
	import ChartStateView from '$lib/components/inverter/_shared/chart-state-view.svelte';
	import OverlayChartView from '$lib/components/inverter/_shared/overlay-chart-view.svelte';
	import * as m from '$lib/paraglide/messages';
	import { inverter } from '$lib/inverter/store.svelte';
	import type { HistoryRange } from '$lib/inverter/ranges';
	import type { ManifestMetric } from '$lib/inverter/types';

	let {
		metric,
		range,
		accent,
		unit,
		diverging,
		overlay,
		drafting,
		data,
		loading,
		plottable,
		xDomain,
		xTickFormat,
		labelFormatter,
		tooltipValue,
		onZoom,
		onResetZoom
	}: {
		metric: ManifestMetric;
		range: HistoryRange;
		accent: string;
		unit: string;
		diverging: boolean;
		/** The full key list while drafting: this metric first, then the rest. */
		overlay: string[];
		drafting: boolean;
		/** The historical rollup rows, already carrying a parsed `date`. */
		data: { date: Date; avg: number; min: number; max: number }[];
		loading: boolean;
		plottable: boolean;
		xDomain: [Date, Date];
		xTickFormat: (value: unknown) => string;
		labelFormatter: (value: unknown) => string;
		tooltipValue: Snippet<[{ value: unknown }]>;
		onZoom?: (next: HistoryRange) => void;
		onResetZoom?: () => void;
	} = $props();
</script>

{#if drafting}
	<!-- The same renderer a saved custom chart uses, driven from a key list
	     nobody has persisted. `h-full` so it fills the expanded card rather than
	     the grid card's fixed box. -->
	<OverlayChartView metrics={overlay} {range} height="h-full" />
{:else if range.live}
	<LiveArea
		points={inverter.series(metric.key)}
		label={metric.label}
		{unit}
		{accent}
		{diverging}
		height="h-full"
	/>
{:else if plottable}
	<MetricHistoryChart
		{data}
		label={metric.label}
		{accent}
		{diverging}
		{xDomain}
		bucket={range.bucket}
		{xTickFormat}
		{labelFormatter}
		{tooltipValue}
		{onZoom}
		{onResetZoom}
		zoomed={range.id === 'zoom'}
	/>
{:else}
	<ChartStateView {loading} message={m.chart_no_data()} />
{/if}
