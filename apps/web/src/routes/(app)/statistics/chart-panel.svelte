<script lang="ts">
	// A bordered chart panel with the house header: what it plots, over which
	// window, and — when the panel owns its section's scope — the switcher that
	// moves it. Every chart panel on the statistics page renders through this so
	// the heading, spacing and fade stay identical across sections.
	import type { Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import RangeSwitcher from '$lib/components/inverter/range-switcher.svelte';
	import PanelSummary, { type PanelSummary as Summary } from './panel-summary.svelte';
	import { panelHeading, scopeOptions, summaryForScope } from '$lib/statistics/chart-scope';
	import type { SectionScope } from '$lib/statistics/chart-scope.svelte';
	import type { CostRange } from '$lib/cost/ranges';

	let {
		title,
		caption,
		view,
		summary,
		switcher,
		children
	}: {
		title: string;
		/** Fixed window caption, for panels that own no scope (the price curves
		 *  are always "today" and "tomorrow", whatever the page range is). */
		caption?: string;
		view?: SectionScope;
		summary?: Summary;
		/** The picked range, passed by the one panel per section that carries the
		 *  scope switcher; the section's other panels follow it. */
		switcher?: CostRange;
		children: Snippet;
	} = $props();

	const heading = $derived(panelHeading(title, view?.caption ?? caption));
	const shownSummary = $derived(summaryForScope(view?.scope, summary));
</script>

<section class="flex flex-col gap-4 border border-border p-4" transition:fade={{ duration: 200 }}>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
			{heading}
		</h2>
		{#if shownSummary}
			<PanelSummary summary={shownSummary} />
		{/if}
		{#if switcher && view}
			<RangeSwitcher
				options={scopeOptions(switcher)}
				bind:value={() => view.scope, (next) => (view.scope = next)}
			/>
		{/if}
	</div>
	{@render children()}
</section>
