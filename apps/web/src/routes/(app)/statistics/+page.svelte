<script lang="ts">
	import type { CostBreakdown } from 'server/src/cost-calc';
	import type { CompareMode, ComparisonResponse } from 'server/src/statistics';
	import { onMount } from 'svelte';
	import SlidersHorizontal from 'phosphor-svelte/lib/SlidersHorizontal';
	import { api } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import CostRangePicker from '$lib/components/inverter/cost-range-picker.svelte';
	import { setPageHeader } from '$lib/page-header.svelte';
	import { useAppSession } from '$lib/session';
	import { resolveCostPreset, type CostRange } from '$lib/cost/ranges';
	import { SECTIONS, type SectionData } from '$lib/statistics/sections';
	import { referenceWindow, usableComparison, windowDays } from '$lib/statistics/compare';
	import { statisticsPrefs } from '$lib/statistics-prefs.svelte';
	import { statisticsLive } from '$lib/statistics-live.svelte';
	import { includesNow } from '$lib/statistics/live';
	import { setCustomizeSession } from '$lib/statistics/customize.svelte';
	import PricePanel from '$lib/components/prices/price-panel.svelte';
	import StatisticsBody from './statistics-body.svelte';
	import CustomizeBar from './customize-bar.svelte';

	let range = $state<CostRange>(resolveCostPreset('month'));
	let cost = $state<CostBreakdown | null>(null);
	let previous = $state<CostBreakdown | null>(null);
	let loading = $state(true);

	// Reference window for the comparison. Ephemeral for every viewer, with the
	// saved preference as its default; an admin's current pick is what the
	// customize draft stores when they save the layout.
	let pickedMode = $state<CompareMode | null>(null);
	const mode = $derived(pickedMode ?? statisticsPrefs.optionFor('records').compareMode);
	function setMode(next: CompareMode) {
		pickedMode = next;
		if (customize.active) customize.draft.records.compareMode = next;
	}

	// Headline tiles: the picked [from, to) priced beside its reference window,
	// in one request so a §51 spot-price load happens once per window server-side.
	// `current` is exactly the breakdown the old /api/cost call returned.
	// `cancelled` guards against an earlier request resolving after a later one
	// and clobbering fresher data. Every section's own charts fetch their own
	// series, because only that section's scope switcher moves them.
	$effect(() => {
		// A live push on a wider now-inclusive range invalidates this window
		// (throttled to a minute by the store); the `today` preset patches below
		// instead and never bumps the signal.
		void statisticsLive.revision;
		const from = range.from.toISOString();
		const to = range.to.toISOString();
		const query = { from, to, mode };
		const reference = referenceWindow(range.from, range.to, mode);
		let cancelled = false;
		loading = true;
		api.api.statistics.comparison.get({ query }).then(({ data }) => {
			if (cancelled) return;
			// usableComparison also drops a reference window that predates recorded
			// history, so a first-month household never reads a fake −100%.
			const pair = usableComparison((data as ComparisonResponse) ?? null, reference);
			cost = pair.current;
			previous = pair.previous;
			loading = false;
		});
		return () => {
			cancelled = true;
		};
	});

	// Live figures, but only while the picked window actually moves: a past-only
	// range (last month, a historical custom range) takes no lease, so the
	// server's periodic job sees zero subscribers and skips entirely.
	$effect(() => (includesNow(range) ? statisticsLive.lease(range) : undefined));

	// On the `today` preset the pushed breakdown *is* the picked window, so the
	// tiles (cost and energy alike — both read these totals) take it straight
	// from the stream instead of refetching. Falls back to the fetched window
	// whenever the stream is down or the range is wider.
	const liveCost = $derived(range.id === 'today' ? (statisticsLive.today?.cost ?? null) : null);

	// Everything the mounted sections read. Null until the first payload lands,
	// which is also what keeps the loading panel up.
	const data = $derived<SectionData | null>(
		cost
			? {
					cost: liveCost ?? cost,
					previous,
					mode,
					windowDays: windowDays(range.from, range.to),
					setMode,
					range
				}
			: null
	);

	// Cost, energy and records have content in this wave; later waves register
	// their sections in section-body.svelte and the filter goes away.
	const activeSections = SECTIONS.filter(
		(s) => s.id === 'cost' || s.id === 'energy' || s.id === 'records'
	);

	// Instance-wide layout preferences. Only admins may edit them, so the gear
	// (and the whole draft/save cycle) is admin-only; everyone else just gets
	// the curated layout.
	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.role === 'admin');
	const customize = setCustomizeSession();
	onMount(() => void statisticsPrefs.load());

	// Hidden sections are not mounted at all outside customize mode, so they
	// drive no fetches; inside it they render dimmed with their eye toggle.
	const visibleSections = $derived(
		customize.active ? activeSections : activeSections.filter((s) => !customize.sectionHidden(s.id))
	);

	// The gear only exists for admins, and disappears once the draft is open.
	const canCustomize = $derived(isAdmin && !customize.active);

	$effect(() => setPageHeader(m.nav_statistics(), m.statistics_subtitle()));
</script>

<div class="flex w-full flex-col gap-6 p-4 sm:p-6">
	{#if customize.active}
		<CustomizeBar />
	{/if}

	<div class="flex flex-wrap items-center justify-end gap-3">
		<CostRangePicker bind:range />
		{#if canCustomize}
			<Button
				variant="ghost"
				size="icon"
				aria-label={m.statistics_customize()}
				title={m.statistics_customize()}
				onclick={() => customize.start()}
			>
				<SlidersHorizontal class="size-4" />
			</Button>
		{/if}
	</div>

	<StatisticsBody sections={visibleSections} {data} {loading} />

	<!-- Day-ahead prices: forward-looking, so deliberately outside the range-driven
	     block above and outside the `cost` guard — it is worth seeing on a fresh
	     install with no priced history yet. Renders nothing when the feed is off. -->
	<PricePanel />
</div>
