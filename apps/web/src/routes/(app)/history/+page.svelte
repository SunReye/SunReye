<script lang="ts">
	import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlass';
	import { inverter } from '$lib/inverter/store.svelte';
	import * as m from '$lib/paraglide/messages';
	import { Input } from '$lib/components/ui/input';
	import DateRangePicker from '$lib/components/inverter/date-range-picker.svelte';
	import CustomChartSection from '$lib/components/inverter/custom-chart-section.svelte';
	import MetricGroup from './metric-group.svelte';
	import { setPageHeader } from '$lib/page-header.svelte';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import {
		chartableMetrics,
		searchedGroups
	} from '$lib/components/inverter/_shared/metric-catalog';
	import { resolvePreset, type HistoryRange } from '$lib/inverter/ranges';

	let range = $state<HistoryRange>(resolvePreset('live'));
	// The window a zoom was taken FROM, so the reset control has somewhere to go
	// back to. Held here rather than derived from the picker: once `range` is the
	// zoomed window the picker no longer knows which preset it came off.
	let beforeZoom = $state<HistoryRange | null>(null);

	// A drag on any one card moves every chart on the page. The zoomed range
	// carries its own bucket (see zoomedHistoryRange), so this is a REFETCH at a
	// finer rollup rather than a magnification of the rows already fetched.
	const zoomTo = (next: HistoryRange) => {
		beforeZoom ??= range;
		range = next;
	};
	const clearZoom = () => {
		if (beforeZoom) range = beforeZoom;
		beforeZoom = null;
	};
	let search = $state('');
	// Per-category open state; groups default open (undefined → true).
	let collapsed = $state<Record<string, boolean>>({});

	const chartable = $derived(chartableMetrics(inverter.metrics));
	const groups = $derived(searchedGroups(chartable, search));

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

	// Picking a preset or a custom span from the toolbar is its own answer to
	// "which window?", so it drops the zoom's way back rather than leaving a
	// reset button pointing at a window nobody asked about any more.
	$effect(() => {
		if (range.id !== 'zoom') beforeZoom = null;
	});

	$effect(() => setPageHeader(m.nav_history(), m.history_subtitle()));
</script>

<PageShell width="wide">
	{#snippet toolbar()}
		<DateRangePicker bind:range />
	{/snippet}

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
		<EmptyState message={emptyMessage} />
	{:else}
		{#each groups as [category, metrics] (category)}
			<MetricGroup
				{category}
				{metrics}
				{range}
				open={isOpen(category)}
				onOpenChange={(v) => (collapsed[category] = !v)}
				onZoom={zoomTo}
				onResetZoom={clearZoom}
			/>
		{/each}
	{/if}
</PageShell>
