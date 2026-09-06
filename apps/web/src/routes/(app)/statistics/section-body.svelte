<script lang="ts">
	import type { Component } from 'svelte';
	import type { SectionData, SectionId } from '$lib/statistics/sections';
	import CostSection from './cost-section.svelte';
	import EnergySection from './energy-section.svelte';
	import PricesSection from './prices-section.svelte';
	import RecordsSection from './records-section.svelte';
	import AmortisationSection from './amortisation-section.svelte';

	// Maps a section id to its content. Every body takes the same shared
	// {@link SectionData} bag and fetches its own chart series from the picked
	// range, so registering a section is one entry in this table.
	const BODIES: Record<SectionId, Component<{ data: SectionData }>> = {
		cost: CostSection,
		energy: EnergySection,
		prices: PricesSection,
		records: RecordsSection,
		amortisation: AmortisationSection
	};

	let { id, data }: { id: SectionId; data: SectionData } = $props();

	const Body = $derived(BODIES[id]);
</script>

<Body {data} />
