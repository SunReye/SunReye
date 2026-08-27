<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import HourlyBarChart from './hourly-bar-chart.svelte';
	import ChartFullscreen from '$lib/components/layout/chart-fullscreen.svelte';
	import { api } from '$lib/api';
	import { periodKeyLabel, COST_X_TICKS } from '$lib/cost/ranges';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as m from '$lib/paraglide/messages';

	// One period of today's hourly energy — the fields the four detail charts read.
	// Mirrors the server's PeriodEnergy (apps/server/src/energy/energy-calc.ts).
	type Period = {
		bucket: string;
		importKwh: number;
		exportKwh: number;
		gridToLoadKwh: number;
		batteryToLoadKwh: number;
		solarDirectToLoadKwh: number;
		selfConsumedKwh: number;
		exportedKwh: number;
	};

	/** Which card opened the dialog — selects the chart's stacked series. */
	type Variant = 'consumption' | 'production' | 'feedin' | 'purchase';

	let {
		variant,
		title,
		triggerClass,
		trigger
	}: {
		variant: Variant;
		title: string;
		/** Card classes — the whole tile becomes the dialog trigger button. */
		triggerClass: string;
		/** Card content, rendered inside the trigger button. */
		trigger: Snippet;
	} = $props();

	let open = $state(false);
	// null while loading (or before first open); array once fetched (may be empty).
	let periods = $state<Period[] | null>(null);

	// Fetch today's hourly series the first time the dialog opens (cheap, and only
	// one dialog is ever open at a time). Kept null until it resolves so the body
	// can show a skeleton without flashing an empty state.
	$effect(() => {
		if (!open || periods !== null) return;
		const now = new Date();
		const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		let cancelled = false;
		api.api.energy.series
			.get({ query: { from: from.toISOString(), to: now.toISOString(), bucket: 'hour' } })
			.then(({ data }) => {
				if (!cancelled) periods = (data ?? []) as Period[];
			});
		return () => {
			cancelled = true;
		};
	});

	const data = $derived(
		(periods ?? []).map((p) => ({ ...p, label: periodKeyLabel(p.bucket, 'hour') }))
	);

	type Series = { key: string; label: string; color: string; value: (d: Period) => number };
	const seriesByVariant: Record<Variant, Series[]> = {
		consumption: [
			{
				key: 'grid',
				label: m.chart_from_grid(),
				color: 'var(--color-energy-grid)',
				value: (d) => d.gridToLoadKwh
			},
			{
				key: 'battery',
				label: m.chart_from_battery(),
				color: 'var(--color-energy-selfused)',
				value: (d) => d.batteryToLoadKwh
			},
			{
				key: 'solar',
				label: m.chart_from_solar(),
				color: 'var(--color-energy-solar)',
				value: (d) => d.solarDirectToLoadKwh
			}
		],
		production: [
			{
				key: 'selfused',
				label: m.chart_used_onsite(),
				color: 'var(--color-energy-selfused)',
				value: (d) => d.selfConsumedKwh
			},
			{
				key: 'export',
				label: m.chart_exported(),
				color: 'var(--color-energy-export)',
				value: (d) => d.exportedKwh
			}
		],
		feedin: [
			{
				key: 'export',
				label: m.chart_exported(),
				color: 'var(--color-energy-export)',
				value: (d) => d.exportedKwh
			}
		],
		purchase: [
			{
				key: 'import',
				label: m.chart_grid_usage(),
				color: 'var(--color-energy-grid)',
				value: (d) => d.importKwh
			}
		]
	};

	const series = $derived(seriesByVariant[variant]);
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger class={triggerClass}>
		{@render trigger()}
	</Dialog.Trigger>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
		</Dialog.Header>
		{#if periods === null}
			<Skeleton class="h-64 w-full rounded" />
		{:else}
			<ChartFullscreen {title}>
				<HourlyBarChart
					{data}
					{series}
					unit="kWh"
					xTicks={COST_X_TICKS.hour}
					empty={m.overview_no_data_today()}
				/>
			</ChartFullscreen>
		{/if}
	</Dialog.Content>
</Dialog.Root>
