<script lang="ts">
	import { fade } from 'svelte/transition';
	import * as msg from '$lib/paraglide/messages';
	import RangeSwitcher from '$lib/components/inverter/range-switcher.svelte';
	import EnergySplitBlock, {
		type SplitSeries
	} from '$lib/components/inverter/energy-split-block.svelte';
	import type { PeriodEnergy } from 'server/src/energy-calc';
	import { periodLabel, type CostBucket } from '$lib/cost/ranges';

	// One period of energy, split for the two stacked bars.
	type Period = PeriodEnergy;

	// Where the household's energy came from and where its solar went, side by
	// side over the section's window. The caller owns the fetch — the energy
	// section reads one series for all its charts — so this only shapes it.
	let {
		caption,
		periods,
		bucket,
		deltas
	}: {
		caption: string;
		periods: Period[];
		bucket: CostBucket;
		/** Change of each ratio against the reference window, for the chips beside
		 *  the averages. Omitted when the chart is not plotting the picked window
		 *  (zoomed out to context), where a delta would compare two different
		 *  things. */
		deltas?: {
			selfSufficiency: number | null;
			selfConsumption: number | null;
			baseline: string;
		};
	} = $props();

	// The two stacks are read the same way whether shown as absolute kWh or as a
	// 100%-normalized share — only the LayerChart series layout changes.
	const LAYOUTS = [
		{ id: 'kwh', label: 'kWh' },
		{ id: 'percent', label: msg.chart_percent_share() }
	] as const;
	let layoutId = $state<(typeof LAYOUTS)[number]['id']>('kwh');
	const seriesLayout = $derived(layoutId === 'percent' ? 'stackExpand' : 'stack');

	const data = $derived(periods.map((p) => ({ ...p, label: periodLabel(p.bucket, bucket) })));
	const hasData = $derived(periods.some((p) => p.loadKwh > 0 || p.productionKwh > 0));

	// Window-average ratio (mean over periods that have the relevant flow), shown
	// beside each chart so they tie back to the headline tiles above.
	const avg = (vals: (number | null)[]) => {
		const present = vals.filter((v): v is number => v !== null);
		return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
	};
	const avgSelfSufficiency = $derived(avg(periods.map((m) => m.selfSufficiency)));
	const avgSelfConsumption = $derived(avg(periods.map((m) => m.selfConsumption)));

	// Resolved once: an undefined delta means "no chip", which is what a chart
	// plotting something other than the picked window wants.
	const chips = $derived(
		deltas ?? { selfSufficiency: undefined, selfConsumption: undefined, baseline: undefined }
	);

	type Series = SplitSeries<Period & { label: string }>;

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

</script>

{#if hasData}
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
			<EnergySplitBlock
				title={msg.energy_consumption()}
				subtitle={msg.chart_consumption_sub()}
				series={consumptionSeries}
				{data}
				{bucket}
				{seriesLayout}
				ratio={avgSelfSufficiency}
				delta={chips.selfSufficiency}
				baseline={chips.baseline}
			/>
			<EnergySplitBlock
				title={msg.energy_production()}
				subtitle={msg.chart_production_sub()}
				series={productionSeries}
				{data}
				{bucket}
				{seriesLayout}
				ratio={avgSelfConsumption}
				delta={chips.selfConsumption}
				baseline={chips.baseline}
			/>
		</div>
	</section>
{/if}
