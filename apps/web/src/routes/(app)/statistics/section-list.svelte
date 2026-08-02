<script lang="ts">
	import type { SectionDef, SectionData } from '$lib/statistics/sections';
	import StatisticsSection from './statistics-section.svelte';
	import SectionBody from './section-body.svelte';

	// The page's section loop: every visible section in registry order, each in
	// the shared collapsible shell around its body.
	let {
		sections,
		data
	}: {
		sections: readonly SectionDef[];
		data: SectionData;
	} = $props();
</script>

{#each sections as section (section.id)}
	<StatisticsSection id={section.id} title={section.label()} caption={data.range.label}>
		<SectionBody id={section.id} {data} />
	</StatisticsSection>
{/each}
