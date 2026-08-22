<script lang="ts">
	// The header row's right-hand cluster: the caller's actions, the full-screen
	// toggle and the collapse caret. Its own file because the header template
	// crossed the complexity gate once the toggle joined the caret there — two
	// guarded branches in a row that have nothing to do with the title block.
	import type { Snippet } from 'svelte';
	import FullscreenTrigger from './fullscreen-trigger.svelte';
	import type { FullscreenBox } from '$lib/charts/fullscreen.svelte';
	import { sectionActionsClass } from '$lib/layout/tokens';

	let {
		actions,
		screen = null
	}: {
		actions?: Snippet;
		screen?: FullscreenBox | null;
	} = $props();
</script>


<!-- Unguarded on purpose: a section with neither actions nor a trigger leaves
     this a zero-width flex child at the end of the row, which changes nothing
     visually — `justify-between` still puts the title block where one child
     alone would sit. Guarding it bought a branch and no pixels. -->
<div data-slot="section-actions" class={sectionActionsClass()}>
	{@render actions?.()}
	{#if screen}
		<!-- Here rather than over the plot: the header already names the chart,
		     and a button floating in the plot's corner would sit on top of the
		     brush surface every one of these charts drag-selects with. -->
		<FullscreenTrigger {screen} />
	{/if}
</div>
