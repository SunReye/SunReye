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

	// The panel's headline figure — the left cell of the readout row, the first
	// row of the panel's body, directly above the plot. In the header's action
	// cluster it was one of four items in a row of buttons, which is what made a
	// two-control header read as five.
	//
	// The scope guard that used to travel with it lives in `panel-readout.svelte`
	// now, for the reason it exists at all: a summary describes the PICKED
	// window, and a chart zoomed out to context drops it instead of restating a
	// figure its bars disagree with — which also decides whether the row above
	// the plot is spent at all, so the caller has to know the answer before this
	// component is reached.
	//
	// `shown` is still optional here even though that caller has already decided.
	// Not defensiveness: it is what lets the caller pass this component a
	// `$derived` directly instead of re-narrowing it inside a snippet, where
	// TypeScript cannot see the guard that the enclosing ternary just applied.
	let { shown }: { shown?: PanelSummary } = $props();
</script>

{#if shown}
		<span data-slot="panel-figure" class="flex items-baseline gap-2">
		<span class="text-lg font-semibold tabular-nums">{shown.value}</span>
		<DeltaChip delta={shown.delta} goodDirection={shown.goodDirection} baseline={shown.baseline} />
	</span>
{/if}
