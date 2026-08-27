<script lang="ts">
	// Zone 3 of the card: the first row of the body, directly above the plot.
	// One value, one place. Before this row a card's headline number and its
	// controls landed wherever each page happened to put them — the figure sat
	// in the body on /statistics, the live reading sat up in the header on
	// /history, and the text controls travelled with whichever of the two the
	// page had chosen. Callers now hand both to this row: value (and its delta)
	// on the left, the card's text controls on the right.
	//
	// Two things it must never do. It must never CENTRE: it is the only zone
	// allowed to wrap, and wrapping here means stacking left-aligned, which is
	// why the layout is a grid from `readoutRowClass()` and not a flex row —
	// a wrapped flex line holding one child still obeys `justify-*`, and that is
	// exactly how the old header cluster ended up centred under a long title.
	// And it must never grow unboundedly: the value cell is `min-w-0` so a long
	// formatted number shrinks rather than shoving a Finnish button label off
	// the right edge.
	// Two rationales that used to sit as markup comments in the template below,
	// moved up here because the template's own size is measured:
	//
	//  - The row is GUARDED, unlike the header's action cluster. That one is a
	//    zero-width box in a row that exists regardless; this row IS a row. Most
	//    cards pass neither snippet, and an unguarded one would spend the body's
	//    gap above every one of their plots.
	//  - The controls cell carries no `justify-*`, on purpose. In the `auto`
	//    column the cell is only as wide as its controls, so packing to the start
	//    already reads as flush right; once the row stacks, that same start is
	//    the left margin the design asks for. `flex-wrap` so three controls take
	//    a second line instead of overflowing when the labels are German.
	import type { Snippet } from 'svelte';
	import { CLUSTER_GAP, readoutRowClass } from '$lib/layout/tokens';

	let {
		value,
		controls
	}: {
		/** The card's headline reading, plus any delta chip beside it. */
		value?: Snippet;
		/** The card's text controls — period tabs, a unit toggle, a link. */
		controls?: Snippet;
	} = $props();

	// Hoisted out of the template: whether this row is worth drawing is one
	// question with one answer, and the template is the one place in this repo
	// that cannot be unit-tested, so it holds no logic it does not have to.
	const filled = $derived(Boolean(value || controls));
</script>

{#if filled}
	<div data-slot="panel-readout-row" class={readoutRowClass()}>
		<div data-slot="panel-readout-value" class="flex min-w-0 flex-wrap items-end {CLUSTER_GAP}">
			{@render value?.()}
		</div>
		<div data-slot="panel-readout-controls" class="flex flex-wrap items-center {CLUSTER_GAP}">
			{@render controls?.()}
		</div>
	</div>
{/if}
