<!-- fallow-ignore-file unused-file -- phase 2.2 of the layout system: the primitives ship before the routes migrate onto them; the migration commits remove this line -->
<script lang="ts">
	// A responsive grid from the shared vocabulary, so no caller hand-rolls one.
	// The hand-rolled ones kept omitting a base column count (`grid sm:grid-cols-2`
	// inherits one column) or `min-w-0` on the children, which is what stacked 31
	// statistics tiles one-up on a phone and let a long total push a row sideways.
	import type { Snippet } from 'svelte';
	import { GRID, type GridVariant } from '$lib/layout/tokens';

	let {
		variant = 'pair',
		children
	}: {
		/** tiles: dense readouts. pair: two blocks side by side. wall: many equal cards. */
		variant?: GridVariant;
		children: Snippet;
	} = $props();
</script>

<div class={GRID[variant]}>
	{@render children()}
</div>
