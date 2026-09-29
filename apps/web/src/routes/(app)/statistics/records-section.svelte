<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { costFormatters } from '$lib/cost/format';
	import type { SectionData } from '$lib/statistics/sections';
	import { queried, useStatisticsQuery } from '$lib/statistics/statistics-query.svelte';
	import { COMPARISON_TILES, RECORD_TILES } from '$lib/statistics/tiles';
	import StatTiles from './stat-tiles.svelte';
	import YoyPanel from './yoy-panel.svelte';

	// Comparisons & records: the picked window against its reference window,
	// the all-time per-day records, and this year against last.
	let { data }: { data: SectionData } = $props();

	const formatters = $derived(costFormatters(data.cost.currency));

	// The compare-mode switcher and the paragraph naming the reference window
	// have both left this section. The switcher is page state and now lives in
	// the page toolbar (`+page.svelte`); the paragraph said "vs the previous 21
	// days", which is the second half of the caption `rangeCaption` already puts
	// under EVERY section title — so this section was printing the page's
	// baseline a second time, as a control row.

	// Rangeless: records cover all recorded history and are cached per day
	// server-side. Today can still set one, so a live push re-reads them.
	const reads = useStatisticsQuery();
	const allTime = queried(() => reads.records(), null);
	const records = $derived(allTime.value);
</script>

<StatTiles defs={COMPARISON_TILES} data={data.cost} previous={data.previous} {formatters} />

{#if records}
	<div class="flex flex-col gap-3">
		<h3 class="text-sm font-medium">{m.statistics_records_all_time()}</h3>
		<StatTiles defs={RECORD_TILES} data={records} {formatters} />
	</div>
{/if}

<YoyPanel {formatters} />
