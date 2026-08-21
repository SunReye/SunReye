<script lang="ts">
	import type { CostBreakdown } from '@SunReye/contracts/energy';
	import type { CompareMode, ComparisonResponse } from '@SunReye/contracts/statistics';
	import { onMount } from 'svelte';
	import SlidersHorizontal from 'phosphor-svelte/lib/SlidersHorizontal';
	import { api } from '$lib/api';
	import { payloadOrNull } from '$lib/api-payload';
	import * as m from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import PeriodNavigator from '$lib/components/inverter/period-navigator.svelte';
	import type { RangeOverride } from '$lib/components/inverter/period-navigator';
	import { setPageHeader } from '$lib/page-header.svelte';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import { useAppSession } from '$lib/session';
	import { costRangeFor, customCostRange, resolveCostPreset } from '$lib/cost/ranges';
	import type { CostRange } from '$lib/cost/ranges';
	import { presetLabel, statisticsPresets } from '$lib/cost/labels';
	import { SECTIONS, type SectionData } from '$lib/statistics/sections';
	import {
		pricedWindow,
		referenceWindow,
		usableComparison,
		windowDays
	} from '$lib/statistics/compare';
	import { statisticsPrefs } from '$lib/statistics-prefs.svelte';
	import { statisticsLive } from '$lib/statistics-live.svelte';
	import { includesNow, liveModeFor } from '$lib/statistics/live';
	import { browserTimeZone } from '$lib/time/browser-zone';
	import { liveClock } from '$lib/time/live-clock.svelte';
	import { periodWindow, type Period } from '$lib/time/period';
	import { setCustomizeSession } from '$lib/statistics/customize.svelte';
	import StatisticsBody from './statistics-body.svelte';
	import CustomizeBar from './customize-bar.svelte';

	// The navigator is one-way, so the page holds the period it is standing on
	// beside the range every section reads. `override` is the window showing
	// INSTEAD of that period — the kept rolling-7-days preset, or an arbitrary
	// custom span — and while it is set no grain tab is lit.
	//
	// Month is the default grain: it is what the deleted `month` preset meant,
	// and it is the window a household reads its bill against.
	//
	// This `new Date()` seeds the opening period and nothing else: the navigator
	// judges "live" against `liveClock.now`, which ticks, so a page left open past
	// a period boundary stops claiming to be live and offers the arrow that
	// reaches the new one. `range` is deliberately not clock-driven — every
	// section fetches from it.
	const zone = browserTimeZone();
	const first = periodWindow(new Date(), 'month', { timeZone: zone });

	let period = $state<Period>(first);
	let override = $state<RangeOverride | null>(null);
	let range = $state<CostRange>(costRangeFor(first, new Date(), zone));

	/** A grain tab or an arrow: the reader moved to a calendar period. */
	function pickPeriod(next: Period) {
		period = next;
		override = null;
		range = costRangeFor(next, new Date(), zone);
	}

	/** The one kept preset — a rolling seven days is not a calendar week. */
	function pickPreset(id: string) {
		const next = resolveCostPreset(id);
		range = next;
		override = { id, label: presetLabel(id, next.label) };
	}

	/**
	 * An arbitrary span, both ends inclusive calendar days.
	 *
	 * This is why `referenceWindow`, `windowDays` and `baselineLabel` are
	 * span-driven rather than a table of preset ids: "vs the previous 17 days"
	 * only exists because a reader can pick 17 days.
	 */
	function pickCustom(start: Date, endInclusive: Date) {
		const next = customCostRange(start, endInclusive, new Date(), zone);
		range = next;
		override = { id: next.id, label: next.label };
	}

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

	/** Whole days of `range` that have happened — the comparison caption's span. */
	function pricedDays(of: CostRange): number {
		const window = pricedWindow(of);
		return windowDays(window.from, window.to);
	}

	// Headline tiles: the picked [from, to) priced beside its reference window,
	// in one request so a §51 spot-price load happens once per window server-side.
	// `current` is exactly the breakdown the old /api/cost call returned.
	// `cancelled` guards against an earlier request resolving after a later one
	// and clobbering fresher data. Every section's own charts fetch their own
	// series, because only that section's scope switcher moves them.
	$effect(() => {
		// A live push on a wider now-inclusive range invalidates this window
		// (throttled to a minute by the store); the Day tab standing on today
		// patches below instead and never bumps the signal.
		void statisticsLive.revision;
		// The PRICED window, not the picked one. A calendar period the reader is
		// standing in ends in the future on purpose (the detail chart wants a
		// settled axis, and the live lease has to hold), and comparing this month
		// so far against the whole of last month reads as a collapse that never
		// happened.
		const window = pricedWindow(range);
		const query = { from: window.from.toISOString(), to: window.to.toISOString(), mode };
		const reference = referenceWindow(window.from, window.to, mode);
		let cancelled = false;
		loading = true;
		api.api.statistics.comparison.get({ query }).then(({ data }) => {
			if (cancelled) return;
			// usableComparison also drops a reference window that predates recorded
			// history, so a first-month household never reads a fake −100%.
			const pair = usableComparison(payloadOrNull<ComparisonResponse>(data), reference);
			cost = pair.current;
			previous = pair.previous;
			loading = false;
		});
		return () => {
			cancelled = true;
		};
	});

	// Live figures, but only while the picked window actually moves: a past-only
	// range (a stepped-back month, a historical custom range) takes no lease, so
	// the server's periodic job sees zero subscribers and skips entirely.
	$effect(() => (includesNow(range) ? statisticsLive.lease(range) : undefined));

	// On the DAY tab standing on today the pushed breakdown *is* the picked
	// window, so the tiles (cost and energy alike — both read these totals) take
	// it straight from the stream instead of refetching. Falls back to the fetched
	// window whenever the stream is down or the range is wider. A PAST day is a
	// window, not today: `liveModeFor` asks the range, not just its id, because
	// every day the reader steps back to is also `"day"`.
	const liveCost = $derived(
		liveModeFor(range) === 'today' ? (statisticsLive.today?.cost ?? null) : null
	);

	// Everything the mounted sections read. Null until the first payload lands,
	// which is also what keeps the loading panel up.
	const data = $derived<SectionData | null>(
		cost
			? {
					cost: liveCost ?? cost,
					previous,
					mode,
					// The days the tiles beside this figure actually cover, so the
					// "vs the previous N days" baseline names the window the server
					// compared rather than a month that has not finished.
					windowDays: pricedDays(range),
					setMode,
					range
				}
			: null
	);

	// Every registered section now has a body. What a given system actually
	// shows is decided further down: preferences hide sections here, and
	// capability gating (a missing spot price feed) drops them in section-list.
	const activeSections = SECTIONS;

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

<PageShell width="wide">
	{#snippet toolbar()}
		<PeriodNavigator
			{period}
			{override}
			presets={statisticsPresets()}
			timeZone={zone}
			now={liveClock.now}
			onPeriod={pickPeriod}
			onPreset={pickPreset}
			onCustomRange={pickCustom}
		/>
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
	{/snippet}

	<!-- The customize bar is a mode banner, not a page control: it owns the full
	     measure and stays under the toolbar it is toggled from. -->
	{#if customize.active}
		<CustomizeBar />
	{/if}

	<StatisticsBody sections={visibleSections} {data} {loading} />
</PageShell>
