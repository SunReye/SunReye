<script lang="ts">
	// "Compare with…" — pull a second metric onto a full-screened history card
	// without saving anything.
	//
	// Deliberately NOT admin-gated, unlike the add-to-chart menu beside it:
	// overlaying two metrics to look at them is a read. It only becomes a write
	// if the reader then saves the draft, and that goes through the ordinary
	// editor, which is admin-gated where it already was.
	//
	// The picker is the editor's, verbatim — same search, same grouped list, same
	// n/8 counter — so the two ways of choosing metrics do not drift into two
	// different lists.
	import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlass';
	import ChartLineUp from 'phosphor-svelte/lib/ChartLineUp';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import MetricPickerList from '$lib/components/inverter/_shared/metric-picker-list.svelte';
	import * as m from '$lib/paraglide/messages';
	import { inverter } from '$lib/inverter/store.svelte';
	import {
		chartableMetrics,
		searchedGroups
	} from '$lib/components/inverter/_shared/metric-catalog';
	import { MAX_CHART_METRICS } from '$lib/inverter/custom-chart';
	import { draftMetrics, isDrafted, toggleDraft } from '$lib/inverter/chart-draft';
	import { TAP } from '$lib/layout/tokens';

	let {
		base,
		draft = $bindable([])
	}: {
		/** The card's own metric. Always drawn, never removable. */
		base: string;
		/** Metrics overlaid on top of it. */
		draft?: string[];
	} = $props();

	let search = $state('');

	const groups = $derived(searchedGroups(chartableMetrics(inverter.metrics), search));
	const drawn = $derived(draftMetrics(base, draft));
	const atLimit = $derived(drawn.length >= MAX_CHART_METRICS);

	const selected = (key: string) => isDrafted(base, draft, key);
	// The card's own metric is drawn and cannot be taken off — `toggleDraft`
	// refuses it, so the row says so rather than ignoring a tap.
	const locked = (key: string) => key === base;
	const toggle = (key: string) => (draft = toggleDraft(base, draft, key));
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="{TAP} text-muted-foreground transition-colors hover:text-foreground"
		title={m.chart_compare_metrics()}
	>
		<ChartLineUp class="size-4" />
		<span class="sr-only">{m.chart_compare_metrics()}</span>
	</DropdownMenu.Trigger>
	<!-- Capped against the viewport, not the card: the card is the screen here,
	     and a 288px menu would still run off a 320px phone. -->
	<DropdownMenu.Content align="end" class="w-72 max-w-[calc(100vw-2rem)] p-0">
		<div class="flex items-center justify-between gap-2 p-2">
			<span class="text-xs font-medium text-muted-foreground">{m.chart_compare_metrics()}</span>
			<span class="text-xs text-muted-foreground">{drawn.length}/{MAX_CHART_METRICS}</span>
		</div>
		<div class="relative px-2 pb-2">
			<MagnifyingGlass
				class="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input placeholder={m.chart_search_metrics()} bind:value={search} class="pl-9" />
		</div>
		<ScrollArea class="h-64 border-t border-border">
			<MetricPickerList
				{groups}
				isSelected={selected}
				isLocked={locked}
				{atLimit}
				onToggle={toggle}
				emptyQuery={search}
			/>
		</ScrollArea>
	</DropdownMenu.Content>
</DropdownMenu.Root>
