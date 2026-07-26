<script lang="ts">
	import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlass';
	import { inverter } from '$lib/inverter/store.svelte';
	import * as m from '$lib/paraglide/messages';
	import { Input } from '$lib/components/ui/input';
	import DateRangePicker from '$lib/components/inverter/date-range-picker.svelte';
	import CustomChartSection from '$lib/components/inverter/custom-chart-section.svelte';
	import MetricGroup from './metric-group.svelte';
	import { setPageHeader } from '$lib/page-header.svelte';
	import {
		filterMetrics,
		groupByCategory,
		isChartable,
		resolvePreset,
		type HistoryRange
	} from '$lib/inverter/ranges';

	let range = $state<HistoryRange>(resolvePreset('live'));
	let search = $state('');
	// Per-category open state; groups default open (undefined → true).
	let collapsed = $state<Record<string, boolean>>({});

	const chartable = $derived(inverter.metrics.filter(isChartable));
	const groups = $derived(groupByCategory(filterMetrics(chartable, search)));

	const hasChartable = $derived(chartable.length > 0);
	// Groups default open (undefined → true).
	const isOpen = (category: string) => !collapsed[category];

	// Why there is nothing to list: no profile data yet, or the search excluded
	// everything. Null once there are groups to render.
	const emptyMessage = $derived.by(() => {
		if (chartable.length === 0) return m.history_waiting_profile();
		if (groups.length === 0) return m.history_no_match({ query: search });
		return null;
	});

	$effect(() => setPageHeader(m.nav_history(), m.history_subtitle()));
</script>

<div class="flex w-full flex-col gap-6 p-4 sm:p-6">
	<div class="flex flex-wrap items-center justify-end gap-3">
		<DateRangePicker bind:range />
	</div>

	<div class="relative max-w-sm">
		<MagnifyingGlass
			class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
		/>
		<Input placeholder={m.history_search_placeholder()} bind:value={search} class="pl-9" />
	</div>

	{#if hasChartable}
		<CustomChartSection {range} />
	{/if}

	{#if emptyMessage}
		<div
			class="flex h-40 items-center justify-center border border-border text-sm text-muted-foreground"
		>
			{emptyMessage}
		</div>
	{:else}
		{#each groups as [category, metrics] (category)}
			<MetricGroup
				{category}
				{metrics}
				{range}
				open={isOpen(category)}
				onOpenChange={(v) => (collapsed[category] = !v)}
			/>
		{/each}
	{/if}
</div>
