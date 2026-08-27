<script lang="ts">
	import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlass';
	import { inverter } from '$lib/inverter/store.svelte';
	import * as m from '$lib/paraglide/messages';
	import { Input } from '$lib/components/ui/input';
	import PeriodNavigator from '$lib/components/inverter/period-navigator.svelte';
	import type { RangeOverride } from '$lib/components/inverter/period-navigator';
	import CustomChartSection from '$lib/components/inverter/custom-chart-section.svelte';
	import MetricGroup from './metric-group.svelte';
	import { setPageHeader } from '$lib/page-header.svelte';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import {
		chartableMetrics,
		searchedGroups
	} from '$lib/components/inverter/_shared/metric-catalog';
	import {
		customRange,
		historyPeriodRange,
		resolvePreset,
		type HistoryRange
	} from '$lib/inverter/ranges';
	import { historyPresetLabel, historyPresets } from '$lib/inverter/range-labels';
	import { browserTimeZone } from '$lib/time/browser-zone';
	import { liveClock } from '$lib/time/live-clock.svelte';
	import { periodWindow, type Period } from '$lib/time/period';

	// THE PAGE HOLDS THREE THINGS, NOT ONE.
	//
	//   `period`   the calendar period the navigator is standing on — the tabs and
	//              the arrows move this, and it is what lights a tab and decides
	//              whether the forward arrow is dead.
	//   `override` the window showing INSTEAD of that period: a kept preset, a
	//              custom span, a zoom. Non-null means no tab is lit.
	//   `range`    what every chart on the page actually renders.
	//
	// They are separate because the navigator is one-way by design: it reports the
	// gesture and owns nothing. `range` cannot be derived from `period` alone
	// either — a zoom writes it from a brush inside a chart, which is not a
	// calendar period at all.
	const zone = browserTimeZone();

	// Resolved once into a const, then handed to both: reading the `period` rune
	// inside another rune's initializer captures its value and not the state.
	//
	// This `new Date()` SEEDS the opening period and does nothing else. Every
	// judgement the navigator makes afterwards — "Today", the live pill, whether
	// the forward arrow is dead — is made against `liveClock.now`, which ticks
	// (see the control's `now` prop). What deliberately does NOT follow the clock
	// is `range`: it is what ~60 metric cards fetch and draw, and re-deriving it on
	// a tick is the shape of the PR #60 loop. So crossing midnight leaves the
	// reader on the window they were looking at, with the title naming it instead
	// of calling it "Today" and the forward arrow alive to reach the new day.
	const first = periodWindow(new Date(), 'day', { timeZone: zone });

	let period = $state<Period>(first);
	let override = $state<RangeOverride | null>(null);
	let range = $state<HistoryRange>(historyPeriodRange(first, new Date(), zone));

	// The window a zoom was taken FROM, so the reset control has somewhere to go
	// back to — with the navigator state that produced it, or the trigger would
	// come back reading the zoomed span it just left.
	let beforeZoom = $state<{ range: HistoryRange; override: RangeOverride | null } | null>(null);

	/** The reader moved to a calendar period: a grain tab, or an arrow. */
	function pickPeriod(next: Period) {
		period = next;
		override = null;
		// Standing on the current DAY is the live view — see historyPeriodRange.
		range = historyPeriodRange(next, new Date(), zone);
	}

	/** One of the kept presets — a rolling window no grain can express. */
	function pickPreset(id: string) {
		const next = resolvePreset(id);
		range = next;
		override = { id, label: historyPresetLabel(id, next.label) };
	}

	/** An arbitrary span. Both ends are inclusive calendar days. */
	function pickCustom(start: Date, endInclusive: Date) {
		const next = customRange(start, endInclusive, zone);
		range = next;
		override = { id: next.id, label: next.label };
	}

	// A drag on any one card moves every chart on the page. The zoomed range
	// carries its own bucket (see zoomedHistoryRange), so this is a REFETCH at a
	// finer rollup rather than a magnification of the rows already fetched.
	const zoomTo = (next: HistoryRange) => {
		beforeZoom ??= { range, override };
		range = next;
		override = { id: next.id, label: next.label };
	};
	const clearZoom = () => {
		if (beforeZoom) {
			range = beforeZoom.range;
			override = beforeZoom.override;
		}
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

	// Picking a preset, a period or a custom span from the toolbar is its own
	// answer to "which window?", so it drops the zoom's way back rather than
	// leaving a reset button pointing at a window nobody asked about any more.
	$effect(() => {
		if (range.id !== 'zoom') beforeZoom = null;
	});

	$effect(() => setPageHeader(m.nav_history(), m.history_subtitle()));
</script>

<PageShell width="wide">
	{#snippet toolbar()}
		<PeriodNavigator
			{period}
			{override}
			presets={historyPresets()}
			timeZone={zone}
			now={liveClock.now}
			onPeriod={pickPeriod}
			onPreset={pickPreset}
			onCustomRange={pickCustom}
		/>
	{/snippet}

	<div class="relative max-w-sm">
		<MagnifyingGlass
			class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
		/>
		<Input placeholder={m.history_search_placeholder()} bind:value={search} class="pl-9" />
	</div>

	{#if hasChartable}
		<CustomChartSection {range} onZoom={zoomTo} onResetZoom={clearZoom} />
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
