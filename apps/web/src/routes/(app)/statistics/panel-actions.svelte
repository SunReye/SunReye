<script lang="ts">
	// The right-hand cluster of a chart panel's header: the window's headline
	// figure, and the switcher that moves the window — for the one panel per
	// section that carries it.
	//
	// Split out of `chart-panel.svelte` because the panel's template branched
	// four ways once the card became `Section`, which put it over the complexity
	// gate. The two are also independent: a panel can have a summary and no
	// switcher, or the reverse.
	import RangeSwitcher from '$lib/components/inverter/range-switcher.svelte';
	import PanelSummary, { type PanelSummary as Summary } from './panel-summary.svelte';
	import { scopeOptions, summaryForScope } from '$lib/statistics/chart-scope';
	import type { SectionScope } from '$lib/statistics/chart-scope.svelte';
	import type { CostRange } from '$lib/cost/ranges';

	let {
		view,
		summary,
		switcher
	}: {
		view?: SectionScope;
		summary?: Summary;
		/** The picked range, passed by the one panel per section that carries the
		 *  scope switcher; the section's other panels follow it. */
		switcher?: CostRange;
	} = $props();

	// A summary describes the PICKED window, so a chart zoomed out to context
	// drops it rather than restating a figure its bars disagree with.
	const shownSummary = $derived(summaryForScope(view?.scope, summary));
</script>

{#if shownSummary}
	<PanelSummary summary={shownSummary} />
{/if}
{#if switcher && view}
	<RangeSwitcher
		options={scopeOptions(switcher)}
		bind:value={() => view.scope, (next) => (view.scope = next)}
	/>
{/if}
