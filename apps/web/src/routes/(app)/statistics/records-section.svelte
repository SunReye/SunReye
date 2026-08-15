<script lang="ts">
	import type { RecordsResponse } from '@SunReye/contracts/statistics';
	import { api } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import RangeSwitcher from '$lib/components/inverter/range-switcher.svelte';
	import { costFormatters } from '$lib/cost/format';
	import type { SectionData } from '$lib/statistics/sections';
	import { COMPARISON_TILES, RECORD_TILES } from '$lib/statistics/tiles';
	import StatTiles from './stat-tiles.svelte';
	import YoyPanel from './yoy-panel.svelte';

	// Comparisons & records: the picked window against its reference window,
	// the all-time per-day records, and this year against last.
	let { data }: { data: SectionData } = $props();

	const formatters = $derived(costFormatters(data.cost.currency));

	const MODES = [
		{ id: 'previous', label: m.statistics_compare_previous() },
		{ id: 'yearAgo', label: m.statistics_compare_year_ago() }
	] as const;

	// Names the reference window in words, so a chip's percentage is never
	// ambiguous about what it is measured against.
	const caption = $derived(
		data.mode === 'yearAgo'
			? m.statistics_records_vs_year()
			: m.statistics_records_vs_previous({ days: data.windowDays })
	);

	// Rangeless: records cover all recorded history and are cached per day
	// server-side, so this fetch runs once with the section.
	let records = $state<RecordsResponse | null>(null);
	$effect(() => {
		let cancelled = false;
		void api.api.statistics.records.get({ query: {} }).then(({ data: payload }) => {
			if (!cancelled) records = (payload as RecordsResponse) ?? null;
		});
		return () => {
			cancelled = true;
		};
	});
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
	<p class="text-xs text-muted-foreground">{caption}</p>
	<RangeSwitcher options={MODES} bind:value={() => data.mode, data.setMode} />
</div>

<StatTiles defs={COMPARISON_TILES} data={data.cost} previous={data.previous} {formatters} />

{#if records}
	<div class="flex flex-col gap-3">
		<h3 class="text-sm font-medium">{m.statistics_records_all_time()}</h3>
		<StatTiles defs={RECORD_TILES} data={records} {formatters} />
	</div>
{/if}

<YoyPanel {formatters} />
