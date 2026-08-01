<script lang="ts">
	import { onMount } from 'svelte';
	import type { SpotPriceView } from 'server/src/spot-price-job';
	import { api } from '$lib/api';
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

	// A one-shot load, not a reactive one: the window is always "today and
	// tomorrow", so unlike the cost tiles above there is no range to re-fetch on.
	onMount(async () => {
		const { data } = await api.api.prices.get();
		view = (data as SpotPriceView | null) ?? null;
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
