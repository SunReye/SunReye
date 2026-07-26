<script lang="ts">
	import CaretDown from 'phosphor-svelte/lib/CaretDown';
	import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlass';
	import { inverter } from '$lib/inverter/store.svelte';
	import * as m from '$lib/paraglide/messages';
	import { Input } from '$lib/components/ui/input';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import DateRangePicker from '$lib/components/inverter/date-range-picker.svelte';
	import EntityHistoryCard from '$lib/components/inverter/entity-history-card.svelte';
	import CustomChartSection from '$lib/components/inverter/custom-chart-section.svelte';
	import { setPageHeader } from '$lib/page-header.svelte';
	import {
		chartableMetrics,
		searchedGroups
	} from '$lib/components/inverter/_shared/metric-catalog';
	import { resolvePreset, type HistoryRange } from '$lib/inverter/ranges';

	let range = $state<HistoryRange>(resolvePreset('live'));
	let search = $state('');
	// Per-category open state; groups default open (undefined → true).
	let collapsed = $state<Record<string, boolean>>({});

	const chartable = $derived(chartableMetrics(inverter.metrics));
	const groups = $derived(searchedGroups(chartable, search));

	const accentFor = (i: number) => `var(--color-chart-${(i % 5) + 1})`;

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

	{#if chartable.length > 0}
		<CustomChartSection {range} />
	{/if}

	{#if chartable.length === 0}
		<div
			class="flex h-40 items-center justify-center border border-border text-sm text-muted-foreground"
		>
			{m.history_waiting_profile()}
		</div>
	{:else if groups.length === 0}
		<div
			class="flex h-40 items-center justify-center border border-border text-sm text-muted-foreground"
		>
			{m.history_no_match({ query: search })}
		</div>
	{:else}
		{#each groups as [category, metrics] (category)}
			<Collapsible.Root
				open={!collapsed[category]}
				onOpenChange={(v) => (collapsed[category] = !v)}
			>
				<Collapsible.Trigger
					class="group flex w-full items-center gap-2 border-b border-border py-2 text-left text-sm font-medium"
				>
					<CaretDown
						class="size-4 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90"
					/>
					{category}
					<span class="text-xs text-muted-foreground">({metrics.length})</span>
				</Collapsible.Trigger>
				<Collapsible.Content>
					<div class="grid gap-4 pt-4 lg:grid-cols-2 xl:grid-cols-3">
						{#each metrics as metric, i (metric.key)}
							<EntityHistoryCard {metric} {range} accent={accentFor(i)} />
						{/each}
					</div>
				</Collapsible.Content>
			</Collapsible.Root>
		{/each}
	{/if}
</div>
