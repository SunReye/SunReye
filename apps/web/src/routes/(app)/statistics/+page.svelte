<script lang="ts">
	import type { Component } from 'svelte';
	import type { CostBreakdown } from 'server/src/cost-calc';
	import { api } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import CostRangePicker from '$lib/components/inverter/cost-range-picker.svelte';
	import { setPageHeader } from '$lib/page-header.svelte';
	import { resolveCostPreset, type CostRange } from '$lib/cost/ranges';
	import { SECTIONS } from '$lib/statistics/sections';
	import PricePanel from '$lib/components/prices/price-panel.svelte';
	import StatisticsSection from './statistics-section.svelte';
	import CostSection from './cost-section.svelte';
	import EnergySection from './energy-section.svelte';

	let range = $state<CostRange>(resolveCostPreset('month'));
	let cost = $state<CostBreakdown | null>(null);
	let loading = $state(true);

	// Headline tiles: priced over the picked [from, to). `cancelled` guards against
	// an earlier request resolving after a later one and clobbering fresher data.
	$effect(() => {
		const from = range.from.toISOString();
		const to = range.to.toISOString();
		let cancelled = false;
		loading = true;
		api.api.cost.get({ query: { from, to } }).then(({ data }) => {
			if (cancelled) return;
			cost = (data as CostBreakdown) ?? null;
			loading = false;
		});
		return () => {
			cancelled = true;
		};
	});

	// First load only: once totals exist a range change refreshes them in place.
	const showLoader = $derived(loading && !cost);

	// Section id → the component that renders it. Every section takes the same
	// two props (the picked window's breakdown and the range itself) and owns its
	// own scope switcher and fetches from there; sections without a component yet
	// simply don't render.
	const SECTION_VIEWS: Record<string, Component<{ cost: CostBreakdown; range: CostRange }>> = {
		cost: CostSection,
		energy: EnergySection
	};
	const activeSections = SECTIONS.filter((s) => s.id in SECTION_VIEWS);

	$effect(() => setPageHeader(m.nav_statistics(), m.statistics_subtitle()));
</script>

<div class="flex w-full flex-col gap-6 p-4 sm:p-6">
	<div class="flex flex-wrap items-center justify-end gap-3">
		<CostRangePicker bind:range />
	</div>

	{#if showLoader}
		<div class="flex h-40 items-center justify-center border border-border text-sm text-muted-foreground">
			{m.costs_loading()}
		</div>
	{:else if cost}
		<!-- Section loop over the registry; each entry renders inside the shared
		     collapsible shell and owns the scope (and fetches) of its own charts,
		     so the shell caption names the picked window, not any one chart. -->
		{#each activeSections as section (section.id)}
			{@const View = SECTION_VIEWS[section.id]}
			<StatisticsSection title={section.label()} caption={range.label}>
				<View {cost} {range} />
			</StatisticsSection>
		{/each}
	{/if}

	<!-- Day-ahead prices: forward-looking, so deliberately outside the range-driven
	     block above and outside the `cost` guard — it is worth seeing on a fresh
	     install with no priced history yet. Renders nothing when the feed is off. -->
	<PricePanel />
</div>
