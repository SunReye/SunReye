<script lang="ts" module>
	/** The window's headline figure over a chart, with its change against the
	 *  reference window. */
	export type PanelSummary = {
		value: string;
		delta: number | null;
		goodDirection: 'up' | 'down' | 'neutral';
		/** What the delta compares against, in words. */
		baseline: string;
	};
</script>

<script lang="ts">
	import DeltaChip from '$lib/components/statistics/delta-chip.svelte';
	import { summaryForScope } from '$lib/statistics/chart-scope';
	import type { SectionScope } from '$lib/statistics/chart-scope.svelte';

	// The panel's headline figure. It sits in the BODY, directly above the plot:
	// in the header's action cluster it was one of four items in a row of
	// buttons, which is what made a two-control header read as five.
	//
	// The scope guard travels with it rather than living in the caller: a summary
	// describes the PICKED window, so a chart zoomed out to context drops it
	// instead of restating a figure its bars disagree with.
	let { view, summary }: { view?: SectionScope; summary?: PanelSummary } = $props();

	const shown = $derived(summaryForScope(view?.scope, summary));
</script>

{#if shown}
	<span data-slot="panel-figure" class="flex items-baseline gap-2">
		<span class="text-lg font-semibold tabular-nums">{shown.value}</span>
		<DeltaChip
			delta={shown.delta}
			goodDirection={shown.goodDirection}
			baseline={shown.baseline}
		/>
	</span>
{/if}
