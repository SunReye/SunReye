<script lang="ts">
	import { fade } from 'svelte/transition';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import LiveArea from '$lib/components/inverter/live-area.svelte';
	import MetricTooltipRow from '$lib/components/inverter/_shared/metric-tooltip-row.svelte';
	import MetricReadout from '$lib/components/inverter/_shared/metric-readout.svelte';
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
		accent = 'var(--color-chart-2)'
	}: {
		metric: ManifestMetric;
		range: HistoryRange;
		accent?: string;
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

<div
	class="flex flex-col gap-3 border border-border p-4"
	use:inView={{ onEnter: enter, onLeave: leave }}
>
	<div class="flex items-baseline justify-between gap-2">
		<h3 class="truncate text-sm font-medium">{metric.label}</h3>
		<MetricReadout value={current} {unit} />
	</div>

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
					{xTickFormat}
					labelFormatter={labelFmt}
					{tooltipValue}
				/>
			{:else}
				<ChartStateView {loading} message={m.chart_no_data()} />
			{/if}
		</div>
	{/if}
</div>

{#snippet tooltipValue({ value }: { value: unknown })}
	<MetricTooltipRow label={metric.label} {value} {unit} />
{/snippet}
