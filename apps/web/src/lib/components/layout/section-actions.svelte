<script lang="ts">
	// The chrome the caller asked for, plus the full-screen toggle — the contents
	// of the header's second grid column, zone 2. Its own file because the header
	// template crossed the complexity gate once the toggle joined the caret there
	// — guarded branches that have nothing to do with the title block.
	//
	// It renders NO box of its own. Column two is a single grid cell holding two
	// things (this and the collapse caret), so the cell is `section-header`'s to
	// draw; a box here as well would nest a second flex row, with a second copy of
	// the cluster gap, inside the first — and it would break the one measurement
	// that proves this whole change, `e2e/statistics-mobile-density.spec.ts`, which
	// compares the cluster's right edge against its PARENT's. With a wrapper in
	// between, that parent is the cluster's own cell and the comparison is
	// trivially true whatever the layout does.
	//
	// Placement is therefore the header grid's business and not this file's: the
	// column is hard right at every width, and nothing here can move it.
	import type { Snippet } from 'svelte';
	import FullscreenTrigger from './fullscreen-trigger.svelte';
	import type { FullscreenBox } from '$lib/charts/fullscreen.svelte';

	let {
		actions,
		screen = null
	}: {
		actions?: Snippet;
		screen?: FullscreenBox | null;
	} = $props();
</script>

{@render actions?.()}
{#if screen}
	<!-- Here rather than over the plot: the header already names the chart,
	     and a button floating in the plot's corner would sit on top of the
	     brush surface every one of these charts drag-selects with. -->
	<FullscreenTrigger {screen} />
{/if}
