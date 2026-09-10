<script lang="ts">
	// Which chart a history card draws, of the three it can: a draft overlay, the
	// rollup window, or a loading/empty state.
	//
	// Its own file because the card's template branched five ways once drafting
	// joined the others, and the branch has nothing to do with the card's
	// header, its lazy mount or its draft bookkeeping.
	//
	// There is no live branch any more. `range.live` used to select the gliding
	// five-minute `LiveArea` here, which is how the Day tab standing on today
	// showed two minutes of the day it named (#216); a live range is a rollup
	// window that keeps appending now (`$lib/inverter/live-tail`), so it draws
	// through the same plot as every other window. `LiveArea` itself is unchanged
	// and still draws the sparkline under a power-flow node detail's KPI.
	import type { Snippet } from 'svelte';
	import MetricHistoryChart from '$lib/components/inverter/_shared/metric-history-chart.svelte';
	import ChartStateView from '$lib/components/inverter/_shared/chart-state-view.svelte';
	import OverlayChartView from '$lib/components/inverter/_shared/overlay-chart-view.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { HistoryRange } from '$lib/inverter/ranges';
	import type { ManifestMetric } from '$lib/inverter/types';

	let {
		metric,
		range,
		accent,
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
		diverging: boolean;
		/** The full key list while drafting: this metric first, then the rest. */
		overlay: string[];
		drafting: boolean;
		/** The rollup points, plus any live buckets spliced past the last one. */
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
	<OverlayChartView
		metrics={overlay}
		{range}
		height="h-full"
		{onZoom}
		{onResetZoom}
		zoomed={range.id === 'zoom'}
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
