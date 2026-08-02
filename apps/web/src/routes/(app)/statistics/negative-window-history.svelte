<script lang="ts">
	import type { NegativeWindow } from '$lib/prices/price-series';
	import * as m from '$lib/paraglide/messages';
	import NegativeWindowList from '$lib/components/prices/negative-window-list.svelte';
	import ChartPanel from './chart-panel.svelte';

	// Every below-zero market window in the analysis period, grouped by day.
	//
	// FOLLOW-UP: a row click should drill into that day's price curve.
	// Deliberately not built — it needs a day-scoped price read, and /api/prices
	// only serves today and tomorrow.
	let {
		windows,
		days,
		/** The raw-slot pass didn't reach the start of the period, so the list
		 *  begins later than the caption suggests and has to say so. */
		truncated
	}: {
		windows: NegativeWindow[];
		days: number;
		truncated: boolean;
	} = $props();
</script>

<ChartPanel
	title={m.statistics_prices_negative_history()}
	caption={days === 1
		? m.statistics_prices_history_caption_one()
		: m.statistics_prices_history_caption_other({ days })}
>
	<NegativeWindowList {windows} emptyLabel={m.prices_no_negative()} />
	{#if truncated}
		<p class="text-xs text-muted-foreground">{m.statistics_prices_history_truncated()}</p>
	{/if}
</ChartPanel>
