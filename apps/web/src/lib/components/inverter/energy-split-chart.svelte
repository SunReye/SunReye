<script lang="ts">
	import { BarChart } from 'layerchart';
	import { fade } from 'svelte/transition';
	import * as Chart from '$lib/components/ui/chart';
	import * as msg from '$lib/paraglide/messages';
	import ChartLegend from '$lib/components/inverter/chart-legend.svelte';
	import RangeSwitcher from '$lib/components/inverter/range-switcher.svelte';
	import { api } from '$lib/api';
	import type { PeriodEnergy } from 'server/src/energy-calc';
	import { COST_X_TICKS, periodLabel, type ChartSpec, type CostBucket } from '$lib/cost/ranges';

	// One period of energy, split for the two stacked bars.
	type Period = PeriodEnergy;

	// Follows the section's chart spec: same window/granularity as the chart it
	// sits under. `periods` lets a section that already fetched the series (the
	// energy section fetches once for all its charts) hand them straight over;
	// without it the chart fetches its own, which is what the cost section does.
	let {
		chart,
		caption,
		periods: given
	}: { chart: ChartSpec; caption: string; periods?: Period[] } = $props();

	// Periods + the granularity they were fetched at, updated together so labels
	// never mix stale periods with a freshly-picked bucket.
	let view = $state<{ periods: Period[]; bucket: CostBucket }>({ periods: [], bucket: 'day' });
	const periods = $derived(given ?? view.periods);
	let loading = $state(true);

	// The two stacks are read the same way whether shown as absolute kWh or as a
	// 100%-normalized share — only the LayerChart series layout changes.
	const LAYOUTS = [
		{ id: 'kwh', label: 'kWh' },
		{ id: 'percent', label: msg.chart_percent_share() }
	] as const;
	let layoutId = $state<(typeof LAYOUTS)[number]['id']>('kwh');
	const seriesLayout = $derived(layoutId === 'percent' ? 'stackExpand' : 'stack');

	$effect(() => {
		if (given) {
			loading = false;
			return;
		}
		const query = {
			from: chart.from.toISOString(),
			to: chart.to.toISOString(),
			bucket: chart.bucket
		};
		let cancelled = false;
		loading = true;
		api.api.energy.series.get({ query }).then(({ data }) => {
			if (cancelled) return;
			view = { periods: (data ?? []) as Period[], bucket: chart.bucket };
			loading = false;
		});
		return () => {
			cancelled = true;
		};
	});

	// Handed-in periods were fetched against the current spec, so they carry the
	// spec's bucket; self-fetched ones carry the bucket they arrived with.
	const bucket = $derived(given ? chart.bucket : view.bucket);
	const data = $derived(periods.map((p) => ({ ...p, label: periodLabel(p.bucket, bucket) })));
	const hasData = $derived(periods.some((p) => p.loadKwh > 0 || p.productionKwh > 0));

	// Window-average ratio (mean over periods that have the relevant flow), shown
	// as a caption so the charts tie back to the headline tiles above.
	const avg = (vals: (number | null)[]) => {
		const present = vals.filter((v): v is number => v !== null);
		return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
	};
	const avgSelfSufficiency = $derived(avg(periods.map((m) => m.selfSufficiency)));
	const avgSelfConsumption = $derived(avg(periods.map((m) => m.selfConsumption)));
	const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

	type Series = { key: string; label: string; color: string; value: (d: Period) => number };

	const consumptionSeries: Series[] = [
		{ key: 'grid', label: msg.chart_from_grid(), color: 'var(--color-energy-grid)', value: (d) => d.gridToLoadKwh },
		{
			key: 'solar',
			label: msg.chart_from_solar_battery(),
			color: 'var(--color-energy-solar)',
			value: (d) => d.solarToLoadKwh
		}
	];
	const productionSeries: Series[] = [
		{
			key: 'selfused',
			label: msg.chart_used_onsite(),
			color: 'var(--color-energy-selfused)',
			value: (d) => d.selfConsumedKwh
		},
		{ key: 'export', label: msg.chart_exported(), color: 'var(--color-energy-export)', value: (d) => d.exportedKwh }
	];

	const configOf = (series: Series[]): Chart.ChartConfig =>
		Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]));
</script>

{#snippet chartBlock(title: string, subtitle: string, series: Series[], ratio: number | null)}
	<!-- min-w-0 lets the grid column shrink below the chart's intrinsic width;
	     without it the block overflows the section edge on narrow screens. -->
	<div class="flex min-w-0 flex-col gap-3">
		<div class="flex items-baseline justify-between gap-3">
			<div class="flex flex-col">
				<h3 class="text-sm font-medium">{title}</h3>
				<span class="text-xs text-muted-foreground">{subtitle}</span>
			</div>
			<span class="shrink-0 whitespace-nowrap text-sm tabular-nums text-muted-foreground">
				{msg.chart_avg()} <span class="font-semibold text-foreground">{pct(ratio)}</span>
			</span>
		</div>
		<Chart.Container config={configOf(series)} class="h-55 w-full">
			<BarChart
				{data}
				x="label"
				{series}
				{seriesLayout}
				bandPadding={0.25}
				stackPadding={2}
				padding={{ top: 8, right: 8, bottom: 20, left: 44 }}
				props={{ xAxis: { ticks: COST_X_TICKS[bucket] } }}
			>
				{#snippet tooltip()}
					<Chart.Tooltip />
				{/snippet}
			</BarChart>
		</Chart.Container>
		<ChartLegend items={series} />
	</div>
{/snippet}

{#if !loading && hasData}
	<section
		class="flex flex-col gap-4 border border-border p-4"
		transition:fade={{ duration: 200 }}
	>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
				{msg.chart_energy_split()} — {caption}
			</h2>
			<RangeSwitcher options={LAYOUTS} bind:value={layoutId} />
		</div>

		<div class="grid gap-8 lg:grid-cols-2">
			{@render chartBlock(
				msg.energy_consumption(),
				msg.chart_consumption_sub(),
				consumptionSeries,
				avgSelfSufficiency
			)}
			{@render chartBlock(
				msg.energy_production(),
				msg.chart_production_sub(),
				productionSeries,
				avgSelfConsumption
			)}
		</div>
	</section>
{/if}
