<script lang="ts">
	import { source } from '$lib/source.svelte';
	import type { RecordsResponse } from '@SunReye/contracts/statistics';
	import { api } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import { costFormatters } from '$lib/cost/format';
	import type { SectionData } from '$lib/statistics/sections';
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
	// server-side, so this fetch runs once with the section.
	let records = $state<RecordsResponse | null>(null);
	$effect(() => {
		let cancelled = false;
		void api.api.statistics.records.get({ query: source.query }).then(({ data: payload }) => {
			if (!cancelled) records = (payload as RecordsResponse) ?? null;
		});
		return () => {
			cancelled = true;
		};
	});
</script>

<StatTiles defs={COMPARISON_TILES} data={data.cost} previous={data.previous} {formatters} />

{#if records}
	<div class="flex flex-col gap-3">
		<h3 class="text-sm font-medium">{m.statistics_records_all_time()}</h3>
		<StatTiles defs={RECORD_TILES} data={records} {formatters} />
	</div>
{/if}

<YoyPanel {formatters} />
