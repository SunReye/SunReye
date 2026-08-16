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
	import CustomLiveChart from '$lib/components/inverter/custom-live-chart.svelte';
	import ChartStateView from '$lib/components/inverter/_shared/chart-state-view.svelte';
	import { api } from '$lib/api';
	import { inverter } from '$lib/inverter/store.svelte';
	import { tooltipLabel, xTick } from '$lib/inverter/chart-format';
	import { resolveAxes, seriesConfig } from '$lib/components/inverter/_shared/chart-series';
	import { mergePoints, overlaySeries, resolveMetrics } from '$lib/inverter/overlay-chart';
	import { CHART_BOX } from '$lib/layout/tokens';
	import type { Datum } from '$lib/inverter/chart-axes';
	import type { HistoryRange } from '$lib/inverter/ranges';

	let {
		metrics,
		range,
		height = CHART_BOX,
		onZoom,
		onResetZoom,
		zoomed = false
	}: {
		/** Metric keys to overlay, in the order the user picked them — position
		 *  decides colour, so this is not a set. */
		metrics: string[];
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

	const series = $derived(overlaySeries(resolved));
	const config = $derived(seriesConfig(series));
	const legendItems = $derived(series.map((s) => ({ key: s.key, label: s.label, color: s.color })));

	// ── Historical mode: one rollup fetch per metric, merged by bucket. ──────────
	type Row = { time: string; avg: number };
	let historical = $state<Datum[]>([]);
	let loading = $state(true);

	$effect(() => {
		if (range.live) return;
		const keys = [...metrics];
		const query = { from: range.from.toISOString(), to: range.to.toISOString(), bucket: range.bucket };
		let cancelled = false;
		loading = true;
		Promise.all(
			keys.map((metric) =>
				api.api.history.rollup
					.get({ query: { metric, ...query, limit: 12000 } })
					.then(({ data }) => ({
						key: metric,
						points: ((data ?? []) as Row[]).map((r) => ({ t: new Date(r.time).getTime(), v: r.avg }))
					}))
			)
		).then((results) => {
			if (cancelled) return;
			historical = mergePoints(results);
			loading = false;
		});
		return () => {
			cancelled = true;
		};
	});

	// ── Live mode: merge the store's in-memory buffers (shared timestamps). ──────
	const live = $derived.by(() =>
		range.live ? mergePoints(metrics.map((key) => ({ key, points: inverter.series(key) }))) : []
	);

	const chartData = $derived(range.live ? live : historical);

	// Pin the x-axis to the whole selected window so a partial day (e.g. "Today"
	// before the day is over) still spans the full range instead of stretching to
	// fit only the data present. Live mode uses its own gliding window.
	const xDomain = $derived<[Date, Date]>([range.from, range.to]);

	const labelFmt = (v: unknown) => tooltipLabel(range, v);
	const xTickFormat = (v: unknown) => xTick(range, v);

	// Mixed units get independent left/right axes; series then plot on a normalized
	// [0,1] scale so a small-magnitude metric (efficiency) isn't drowned by a large
	// one (power). Single-unit charts keep the plain filled area on one axis.
	//
	// Resolved from the data actually DRAWN, not from `historical`. In live mode
	// `historical` is empty, so axes resolved from it are empty too — inert only
	// because the plot checks `live` before it reads them. A draft is built live
	// and saved into the historical path, so it would be the first thing to walk
	// into that.
	const axes = $derived(resolveAxes(chartData, series));

	// A historical query is in flight (live mode streams instead of fetching).
	const fetching = $derived(!range.live && loading);
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
			<!-- The live form glides its own window through a transform inside a
			     ChartClipPath, so it takes neither the zoom controller nor the
			     reset control — a second transform composes badly. -->
			{#if range.live}
				<CustomLiveChart data={chartData} {series} {config} labelFormatter={labelFmt} />
			{:else}
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
			{/if}
		</div>
	{:else}
		<ChartStateView loading={fetching} message={emptyMessage} />
	{/if}
</div>

<ChartLegend items={legendItems} />

{#if missing.length > 0}
	<p class="text-xs text-muted-foreground">{missingNote}</p>
{/if}
