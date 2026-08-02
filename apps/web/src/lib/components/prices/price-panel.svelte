<script lang="ts">
	import type { SpotPriceView } from 'server/src/spot-price-job';
	import { api } from '$lib/api';
	import { statisticsLive } from '$lib/statistics-live.svelte';
	import SettingsSection from '$lib/components/settings/settings-section.svelte';
	import PriceTrackChart from './price-track-chart.svelte';
	import NegativeWindowList from './negative-window-list.svelte';
	import PriceNotes from './price-notes.svelte';
	import { negativeWindows, priceRows } from '$lib/prices/price-series';
	import * as m from '$lib/paraglide/messages';

	// Day-ahead prices for today + tomorrow. Renders nothing at all when the feed
	// is off or unconfigured, so the Costs screen is unchanged for anyone not
	// using it.
	let view = $state<SpotPriceView | null>(null);

	// The window is always "today and tomorrow", so there is no range to re-fetch
	// on — the only thing that changes the answer is a spot-price sync, which the
	// live statistics stream signals. Without that signal this stays the one-shot
	// load it was.
	$effect(() => {
		void statisticsLive.priceRevision;
		let cancelled = false;
		void api.api.prices.get().then(({ data }) => {
			if (!cancelled) view = (data as SpotPriceView | null) ?? null;
		});
		return () => {
			cancelled = true;
		};
	});

	// Narrowing from the `{#if}` doesn't reach inside a snippet closure, so every
	// field the template needs is read through its own derived value.
	const zone = $derived(view?.zone ?? '');
	const rows = $derived(view ? priceRows(view) : []);
	const windows = $derived(view ? negativeWindows(view) : []);
	// Tomorrow's auction clears around 13:00 market time. Until then the absence
	// of negative slots tomorrow is *unknown*, not "none".
	const tomorrowPending = $derived(view !== null && view.coverage.tomorrow !== 'complete');
	// An hourly source cannot resolve a negative quarter-hour inside a
	// net-positive hour, which is the whole §51 case, so it must be admitted.
	const coarse = $derived((view?.resolutionMinutes ?? 15) > 15);
	const attribution = $derived(view?.attribution ?? null);
</script>

{#if view}
	<SettingsSection title={m.prices_title()}>
		{#snippet actions()}
			<span class="text-xs text-muted-foreground tabular-nums">{zone}</span>
		{/snippet}

		<PriceTrackChart {rows} />
		<NegativeWindowList {windows} showEmpty={!tomorrowPending} />
		<PriceNotes {tomorrowPending} {coarse} {attribution} />
	</SettingsSection>
{/if}
