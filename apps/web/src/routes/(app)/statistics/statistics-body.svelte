<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { SectionDef, SectionData } from '$lib/statistics/sections';
	import SectionList from './section-list.svelte';

	// Page body: the section list once the first payload is in, the one-time
	// loading panel before it. A range change refreshes the sections in place
	// rather than dropping back to the loader.
	let {
		sections,
		data,
		loading
	}: {
		sections: readonly SectionDef[];
		/** null until the first fetch resolves. */
		data: SectionData | null;
		loading: boolean;
	} = $props();
</script>

{#if data}
	<SectionList {sections} {data} />
{:else if loading}
	<div
		class="flex h-40 items-center justify-center border border-border text-sm text-muted-foreground"
	>
		{m.costs_loading()}
	</div>
{/if}
