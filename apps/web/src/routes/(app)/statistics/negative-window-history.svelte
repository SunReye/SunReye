<script lang="ts">
	import type { NegativeWindow } from '$lib/prices/price-series';
	import * as m from '$lib/paraglide/messages';
	import NegativeWindowList from '$lib/components/prices/negative-window-list.svelte';
	import Section from '$lib/components/layout/section.svelte';

	// Every below-zero market window in the analysis period, grouped by day.
	//
	// A plain `Section`, not a `ChartPanel`: this block plots nothing. Through
	// the panel it inherited a full-screen control, which promised a bigger view
	// of a list that is height-unconstrained and already fully visible in the
	// scrolling page — one of the nine expand buttons on this page that had
	// nothing to expand. `nested` for the same reason the panels are: this
	// renders inside a statistics section, and a phone cannot afford a second
	// frame. Pinned by `lib/charts/fullscreen-coverage.test.ts`.
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

	const caption = $derived(
		days === 1
			? m.statistics_prices_history_caption_one()
			: m.statistics_prices_history_caption_other({ days })
	);
</script>

<Section title={m.statistics_prices_negative_history()} {caption} nested>
	<NegativeWindowList {windows} emptyLabel={m.prices_no_negative()} />
	{#if truncated}
		<p class="text-xs text-muted-foreground">{m.statistics_prices_history_truncated()}</p>
	{/if}
</Section>
