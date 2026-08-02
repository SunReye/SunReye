<script lang="ts">
	import type { SectionData } from '$lib/statistics/sections';
	import CostSection from './cost-section.svelte';
	import EnergySection from './energy-section.svelte';
	import RecordsSection from './records-section.svelte';

	// Maps a section id to its content. Sections added in later waves register
	// here; everything they need is already in the shared {@link SectionData},
	// and each section fetches its own chart series from the picked range.
	let { id, data }: { id: string; data: SectionData } = $props();
</script>

{#if id === 'cost'}
	<CostSection cost={data.cost} range={data.range} />
{:else if id === 'energy'}
	<EnergySection cost={data.cost} previous={data.previous} range={data.range} />
{:else if id === 'records'}
	<RecordsSection {data} />
{/if}
