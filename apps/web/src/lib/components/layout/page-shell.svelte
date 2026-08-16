<!-- fallow-ignore-file unused-file -- phase 2.2 of the layout system: the primitives ship before the routes migrate onto them; the migration commits remove this line -->
<script lang="ts">
	// The one page container. Every route's outermost element is this, so the
	// content measure, gutter and vertical rhythm stop being a per-page choice —
	// seven pages had drifted to five rhythms and four measures, and /automations
	// and /automations/peak-shaving disagreed hard enough that the measure jumped
	// while navigating between them.
	//
	// It deliberately accepts NO `class` prop: an escape hatch here is exactly how
	// the drift happened. A page that genuinely needs a bespoke layout asks for
	// width="full" and owns its own inner markup.
	import type { Snippet } from 'svelte';
	import { CLUSTER_GAP, pageShellClass, type ShellWidth } from '$lib/layout/tokens';

	let {
		width = 'wide',
		toolbar,
		children
	}: {
		/** Content measure, by intent: narrow (forms/lists), wide (dashboards), full. */
		width?: ShellWidth;
		/** Page-level controls — range pickers, primary actions. Rendered first,
		 *  right-aligned, wrapping onto its own lines on a phone. */
		toolbar?: Snippet;
		children: Snippet;
	} = $props();
</script>

<div class={pageShellClass(width)}>
	{#if toolbar}
		<div class="flex flex-wrap items-center justify-end {CLUSTER_GAP}">
			{@render toolbar()}
		</div>
	{/if}
	{@render children()}
</div>
