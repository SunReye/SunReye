<script lang="ts">
	// Test-only host for `section-list.svelte`: it reads the page's customize
	// session and statistics query from context, so this puts both there and
	// hands it the whole registry, as the gate under test must do the filtering.
	import { SECTIONS } from '$lib/statistics/sections';
	import { setCustomizeSession } from '$lib/statistics/customize.svelte';
	import { provideStatisticsQuery } from '$lib/statistics/statistics-query.svelte';
	import { fakeSectionData, fakeStatisticsQuery } from './statistics.fixture.ts';
	import SectionList from './section-list.svelte';

	setCustomizeSession();
	provideStatisticsQuery(fakeStatisticsQuery());
</script>

<SectionList sections={SECTIONS} data={fakeSectionData()} />
