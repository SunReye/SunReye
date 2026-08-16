<!-- fallow-ignore-file unused-file -- phase 2.2 of the layout system: reachable only through `section.svelte`, which the routes have not migrated onto yet; the migration commits remove this line -->
<script lang="ts">
	// The section card's collapsible content.
	//
	// Carried over from `statistics/statistics-section.svelte`, the only one of
	// the six variants that got this right: forceMount + child snippet so the
	// content can transition on its way out, and a slide that respects
	// `prefers-reduced-motion`. Split out of `section.svelte` with the header,
	// so the card itself is a declarative three-liner again.
	import type { Snippet } from 'svelte';
	import { slide } from 'svelte/transition';
	import { MediaQuery } from 'svelte/reactivity';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { SECTION_GAP } from '$lib/layout/tokens';
	import { slideParams } from '$lib/layout/section-state';

	let { children }: { children: Snippet } = $props();

	const reduceMotion = new MediaQuery('prefers-reduced-motion: reduce');
	const slideConfig = $derived(slideParams(reduceMotion.current));
</script>

<!-- forceMount + child so the content can slide in and out; a closed section
     unmounts entirely, so nothing hidden keeps driving fetches. -->
<Collapsible.Content forceMount>
	{#snippet child({ props, open: contentOpen })}
		{#if contentOpen}
			<div {...props} transition:slide={slideConfig} class="flex flex-col {SECTION_GAP}">
				{@render children()}
			</div>
		{/if}
	{/snippet}
</Collapsible.Content>
