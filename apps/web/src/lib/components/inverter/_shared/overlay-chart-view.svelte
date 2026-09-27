<script lang="ts">
	// A list of metric keys, drawn as one overlaid chart: the plot, its legend,
	// its loading and empty states, and the note naming keys the active profile
	// no longer has.
	//
	// Lifted out of `custom-chart-card.svelte`, where all of it sat in the body
	// of a component that takes a saved `CustomChart` — so the only way to draw
	// an overlay was to have persisted one first. It takes a bare `string[]` now,
	// which is what lets a DRAFT (metrics the user is trying out on a
	// full-screened card, that no server has seen) render through exactly the
	// same path as a saved chart. Two renderers would have been two things to
	// keep in step.
	import { fade } from 'svelte/transition';
	import * as msg from '$lib/paraglide/messages';
	import ChartLegend from '$lib/components/inverter/chart-legend.svelte';
	import CustomChartPlot from '$lib/components/inverter/_shared/custom-chart-plot.svelte';
	import ChartStateView from '$lib/components/inverter/_shared/chart-state-view.svelte';
	import { inverter } from '$lib/inverter/store.svelte';
	import { tooltipLabel, xTick } from '$lib/inverter/chart-format';
	import { resolveAxes, seriesConfig } from '$lib/components/inverter/_shared/chart-series';
	import {
		overlayDatums,
		overlaySeries,
		resolveMetrics,
		seriesScope
	} from '$lib/inverter/overlay-chart';
	import { source } from '$lib/source.svelte';
	import { liveRollup } from '$lib/inverter/live-rollup.svelte';
	import { CHART_BOX } from '$lib/layout/tokens';
	import type { HistoryRange } from '$lib/inverter/ranges';

	let {
		metrics,
		colors = {},
		devices = {},
		range,
		height = CHART_BOX,
		onZoom,
		onResetZoom,
		zoomed = false
	}: {
		/** Metric keys to overlay, in the order the user picked them — position
		 *  decides colour, so this is not a set. */
		metrics: string[];
		/** Per-series colour overrides, keyed by metric key. A draft has none. */
		colors?: Record<string, string>;
		/** The device each series is pinned to, keyed by metric key. Unpinned
		 *  keys follow the header's source switcher. A draft has none. */
		devices?: Record<string, string>;
		range: HistoryRange;
		/** Plot box height class. A draft fills its full-screen card. */
		height?: string;
		/**
		 * A window drag-selected on this chart. The owner answers by refetching
		 * it, exactly as a single-metric card does — /history moves every chart on
		 * the page onto the finer range.
		 */
		onZoom?: (next: HistoryRange) => void;
		onResetZoom?: () => void;
		/** The owner is currently showing a zoomed window. */
		zoomed?: boolean;
	} = $props();

	// A key can vanish under a saved chart when the profile changes, and under a
	// draft when the manifest reloads. Surfaced rather than silently drawing
	// fewer series than the user picked.
	const catalog = $derived(resolveMetrics(inverter.metrics, metrics));
	const resolved = $derived(catalog.resolved);
	const missing = $derived(catalog.missing);

	const series = $derived(overlaySeries(resolved, colors));
	const config = $derived(seriesConfig(series));
	const legendItems = $derived(series.map((s) => ({ key: s.key, label: s.label, color: s.color })));

	// ── The window's rows, one fetch per metric, merged by bucket ────────────────
	// EVERY range is fetched, the current day included. It used to be skipped when
	// `range.live` and the gliding five-minute `CustomLiveChart` drawn instead —
	// so on /history's Day tab standing on today, the custom-chart section at the
	// top of the page showed the last two minutes above a grid of full-day cards
	// (#216). `live` now means only "the right edge is the future, keep
	// appending", the same as it does for a single-metric card.
	//
	// One delta query per tick, sized for the key that lags furthest behind,
	// merged into each key's rows; closed live buckets past each key's last
	// fetched one are spliced per key. All of it is `liveRollup`'s.
	//
	// Each series reads the device the chart names for it, else the header's
	// source — the scope the metric card beside it reads. It used to send no
	// `source` at all, so an overlay showed the plant whatever the switcher said.
	const rollup = liveRollup({
		keys: () => metrics,
		range: () => range,
		scope: () => seriesScope(devices, source.query),
		enabled: () => true,
		live: (key) => inverter.series(key)
	});
	const loading = $derived(rollup.loading);
	const chartData = $derived(overlayDatums(rollup.feeds, rollup.span));

	// Pin the x-axis to the whole selected window so a partial day (e.g. "Today"
	// before the day is over) still spans the full range instead of stretching to
	// fit only the data present.
	const xDomain = $derived<[Date, Date]>([range.from, range.to]);

	const labelFmt = (v: unknown) => tooltipLabel(range, v);
	const xTickFormat = (v: unknown) => xTick(range, v);

	// Mixed units get independent left/right axes; series then plot on a normalized
	// [0,1] scale so a small-magnitude metric (efficiency) isn't drowned by a large
	// one (power). Single-unit charts keep the plain filled area on one axis.
	//
	// Resolved from the data actually DRAWN. There is one data path now, so this
	// can no longer be handed an empty list that the plot happens not to read.
	const axes = $derived(resolveAxes(chartData, series));

	/** The window's query is in flight. */
	const fetching = $derived(loading);
	const plottable = $derived(resolved.length > 0 && !fetching && chartData.length > 0);
	const emptyMessage = $derived(
		resolved.length === 0 ? msg.chart_none_available() : msg.chart_no_data()
	);

	const missingNote = $derived(
		missing.length === 1
			? msg.chart_metrics_unavailable_one({ count: missing.length })
			: msg.chart_metrics_unavailable_other({ count: missing.length })
	);
</script>

<div class="{height} w-full">
	{#if plottable}
		<div class="h-full w-full" in:fade={{ duration: 300 }}>
			<CustomChartPlot
				data={chartData}
				{series}
				{config}
				{axes}
				{xDomain}
				labelFormatter={labelFmt}
				{xTickFormat}
				bucket={range.bucket}
				{onZoom}
				{onResetZoom}
				{zoomed}
			/>
		</div>
	{:else}
		<ChartStateView loading={fetching} message={emptyMessage} />
	{/if}
</div>

<ChartLegend items={legendItems} />

{#if missing.length > 0}
	<p class="text-xs text-muted-foreground">{missingNote}</p>
{/if}
