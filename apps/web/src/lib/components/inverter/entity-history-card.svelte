<script lang="ts">
	import { fade } from 'svelte/transition';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import Section from '$lib/components/layout/section.svelte';
	import LiveArea from '$lib/components/inverter/live-area.svelte';
	import MetricTooltipRow from '$lib/components/inverter/_shared/metric-tooltip-row.svelte';
	import MetricCardActions from '$lib/components/inverter/_shared/metric-card-actions.svelte';
	import MetricHistoryChart from '$lib/components/inverter/_shared/metric-history-chart.svelte';
	import ChartStateView from '$lib/components/inverter/_shared/chart-state-view.svelte';
	import { api } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import { inverter } from '$lib/inverter/store.svelte';
	import { inView } from '$lib/actions/in-view';
	import { tooltipLabel, xTick } from '$lib/inverter/chart-format';
	import type { HistoryRange } from '$lib/inverter/ranges';
	import type { ManifestMetric } from '$lib/inverter/types';

	let {
		metric,
		range,
		accent = 'var(--color-chart-2)',
		onZoom,
		onResetZoom
	}: {
		metric: ManifestMetric;
		range: HistoryRange;
		accent?: string;
		/** A window drag-selected on this card's chart. The page answers it by
		 *  moving every card onto the finer range — see /history's `range`. */
		onZoom?: (next: HistoryRange) => void;
		onResetZoom?: () => void;
	} = $props();

	// Signed metrics (battery/grid power) split the fill red/green around zero.
	const diverging = $derived(!!metric.flow);
	const unit = $derived(metric.unit ?? '');

	// Lazy mount: only fetch/animate once scrolled near the viewport, and drop the
	// chart when it leaves so 100+ cards don't all run at once.
	let visible = $state(false);

	// Live current value from the store (updates on every WebSocket sample).
	const current = $derived(inverter.value(metric.key));

	// ── Historical mode ─────────────────────────────────────────────────────────
	type Row = { time: string; avg: number; min: number; max: number };
	let rows = $state<Row[]>([]);
	let loading = $state(true);

	$effect(() => {
		if (!visible || range.live) return;
		const query = {
			metric: metric.key,
			from: range.from.toISOString(),
			to: range.to.toISOString(),
			bucket: range.bucket,
			// A 7-day window renders as minute rollups (~10k points); cap high
			// enough that the ascending, limited query isn't truncated to the
			// oldest slice of the range.
			limit: 12000
		};
		let cancelled = false;
		loading = true;
		api.api.history.rollup.get({ query }).then(({ data }) => {
			if (cancelled) return;
			rows = (data ?? []) as Row[];
			loading = false;
		});
		return () => {
			cancelled = true;
		};
	});

	const chartData = $derived(rows.map((r) => ({ ...r, date: new Date(r.time) })));

	const labelFmt = (value: unknown) => tooltipLabel(range, value);
	const xTickFormat = (value: unknown) => xTick(range, value);

	const xDomain = $derived<[Date, Date]>([range.from, range.to]);
	/** True once the historical query has landed with rows to draw. */
	const plottable = $derived(!loading && chartData.length > 0);

	const enter = () => (visible = true);
	const leave = () => (visible = false);
</script>

<!-- The observer has to watch the card's outermost box, or a category of 100+
     charts mounts all at once — and `Section` takes neither a `class` nor a
     `use:` action, by design. So the root is a bare wrapper: no frame, no pad,
     nothing that would draw a second border around the card inside it.
     `nested` because every one of these sits inside a metric-group Section. -->
<div use:inView={{ onEnter: enter, onLeave: leave }}>
	<Section title={metric.label} nested fullscreen>
		{#snippet actions()}
			<MetricCardActions metricKey={metric.key} value={current} {unit} />
		{/snippet}

		{#if !visible}
			<Skeleton class="h-50 w-full" />
		{:else}
			<!-- Fades in once the card scrolls into view; the wrapper persists across the
			     loading→data swap so the fade only plays on entry, not on every refetch. -->
			<div class="h-50 w-full" in:fade={{ duration: 300 }}>
				{#if range.live}
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
						data={chartData}
						label={metric.label}
						{accent}
						{diverging}
						{xDomain}
						bucket={range.bucket}
						{xTickFormat}
						labelFormatter={labelFmt}
						{tooltipValue}
						{onZoom}
						{onResetZoom}
						zoomed={range.id === 'zoom'}
					/>
				{:else}
					<ChartStateView {loading} message={m.chart_no_data()} />
				{/if}
			</div>
		{/if}
	</Section>
</div>

{#snippet tooltipValue({ value }: { value: unknown })}
	<MetricTooltipRow label={metric.label} {value} {unit} />
{/snippet}
