<script lang="ts">
	// Test-only host for `energy-section.svelte`: it reads the page's customize
	// session and statistics query from context. Used by
	// `energy-section.svelte.test.ts`.
	import { setCustomizeSession } from '$lib/statistics/customize.svelte';
	import { provideStatisticsQuery } from '$lib/statistics/statistics-query.svelte';
	import { fakeSectionData, fakeStatisticsQuery } from './statistics.fixture.ts';
	import EnergySection from './energy-section.svelte';

	setCustomizeSession();
	provideStatisticsQuery(fakeStatisticsQuery());
</script>

<EnergySection data={fakeSectionData()} />
