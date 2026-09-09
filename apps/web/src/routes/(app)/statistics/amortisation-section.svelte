<script lang="ts">
	import { source } from '$lib/source.svelte';
	import type { AmortisationResponse } from '@SunReye/contracts/statistics';
	import { api } from '$lib/api';
	import { payloadOrNull } from '$lib/api-payload';
	import * as m from '$lib/paraglide/messages';
	import { costFormatters } from '$lib/cost/format';
	import type { SectionData } from '$lib/statistics/sections';
	import { AMORTISATION_TILES } from '$lib/statistics/tiles';
	import { statisticsLive } from '$lib/statistics-live.svelte';
	import InvestmentPrompt from './investment-prompt.svelte';
	import PaybackBar from './payback-bar.svelte';
	import SeasonalNote from './seasonal-note.svelte';
	import StatTiles from './stat-tiles.svelte';

	// Amortisation: what the plant cost against what its lifetime counters say it
	// saved, and when the two meet. Rangeless — the figures run from
	// commissioning, so the page's window plays no part; the shared bag lends
	// only its currency, so the tiles format in the plant's money from the first
	// paint.
	let { data }: { data: SectionData } = $props();

	let result = $state<AmortisationResponse | null>(null);
	// The lifetime counters tick with every poll; the live signal (throttled to
	// a minute) is enough to keep the savings figure moving on a wall display.
	$effect(() => {
		void statisticsLive.revision;
		let cancelled = false;
		void api.api.statistics.amortisation.get({ query: source.query }).then(({ data: payload }) => {
			if (!cancelled) result = payloadOrNull<AmortisationResponse>(payload);
		});
		return () => {
			cancelled = true;
		};
	});

	const formatters = $derived(costFormatters(result?.currency ?? data.cost.currency));
</script>

{#if result}
	{#if result.progress !== null}
		<PaybackBar progress={result.progress} rates={result.rates} {formatters} />
	{/if}

	<StatTiles defs={AMORTISATION_TILES} data={result} {formatters} />

	<SeasonalNote weighting={result.weighting} gaps={result.seasonalGaps} />

	{#if !result.configured}
		<InvestmentPrompt />
	{/if}
{/if}
