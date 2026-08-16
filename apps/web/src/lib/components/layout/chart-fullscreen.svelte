<script lang="ts">
	// Full screen for a chart that has no section card to put the control in —
	// the two dialogs and the forecast-correction panel. Everywhere else the
	// trigger lives in `Section`'s header, beside the title that already names
	// the chart; see `layout/section-header.svelte`.
	//
	// Wraps the chart box rather than replacing it: the chart inside is the same
	// component at the same props, so its brush, pinch-zoom and tooltip keep
	// working expanded. A second, "big" copy would have been a second thing to
	// keep in step with the small one.
	import type { Snippet } from 'svelte';
	import FullscreenTrigger from './fullscreen-trigger.svelte';
	import { FullscreenBox } from '$lib/charts/fullscreen.svelte';
	import { portal } from '$lib/actions/portal';
	import { expandedChartClass } from '$lib/layout/tokens';

	let {
		title,
		children
	}: {
		/** Names the chart in the expanded header — it has no card up there. */
		title: string;
		children: Snippet;
	} = $props();

	const screen = new FullscreenBox();
	$effect(() => screen.listen());
</script>

<!-- Portalled while expanded: `fixed inset-0` resolves against the nearest
     ancestor that establishes a containing block, and a CSS transform does —
     `Dialog.Content` centres itself with one, so a chart expanded from inside
     the energy or forecast dialog filled the DIALOG. Leaving the subtree fixes
     it for every such ancestor (transform, filter, contain) at once, without
     touching a vendored primitive every dialog shares. -->
<div use:portal={screen.expanded} class={expandedChartClass(screen.expanded)}>
	<div class="flex items-center justify-between gap-3">
		{#if screen.expanded}
			<h2 class="truncate text-sm font-medium uppercase tracking-wide text-muted-foreground">
				{title}
			</h2>
		{:else}
			<span class="sr-only">{title}</span>
		{/if}
		<FullscreenTrigger {screen} class="ml-auto" />
	</div>

	{@render children()}
</div>
