<script lang="ts">
	import type { SectionDef, SectionData, SectionId } from '$lib/statistics/sections';
	import { rangeCaption } from '$lib/cost/labels';
	import { queried, useStatisticsQuery } from '$lib/statistics/statistics-query.svelte';
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

	// Capability gating, which is not the same thing as preference hiding: a
	// system with no spot price feed has no price section to show, hide or
	// toggle in customize mode, so the gate sits here rather than in the prefs.
	// The one read it needs is also the section's own payload, and the page's
	// query module hands the body the same answer, so gating costs no extra request.
	const reads = useStatisticsQuery();
	const spot = queried(() => reads.spotStats(data.range.from, data.range.to), null);
	// False until the first answer lands — the section stays away until then
	// rather than appearing and vanishing.
	const available = (id: SectionId): boolean => id !== 'prices' || (spot.loaded && spot.value !== null);

	const shown = $derived(sections.filter((s) => available(s.id)));
</script>

{#each shown as section (section.id)}
	<StatisticsSection id={section.id} title={section.label()} caption={rangeCaption(data.range, data.mode)}>
		<SectionBody id={section.id} {data} />
	</StatisticsSection>
{/each}
