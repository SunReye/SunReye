<script lang="ts">
	import type { HeatmapCell } from '@SunReye/contracts/statistics';
	import { api } from '$lib/api';
	import RangeSwitcher from '$lib/components/inverter/range-switcher.svelte';
	import HeatGrid from './heat-grid.svelte';
	import { heatKwh, hourLabel, weekdayLabel, type HeatPoint } from '$lib/statistics/heatmap';
	import * as m from '$lib/paraglide/messages';

	// "When does this house actually use energy?" — the picked window folded onto
	// one week of hours. Every cell is an AVERAGE (the window's sum for that slot
	// divided by how many times the slot occurred), so a 3-day and a 90-day window
	// are read the same way. The grid itself is HeatGrid; this owns the metric
	// choice and the two ways the panel can be empty.
	let { from, to }: { from: Date; to: Date } = $props();

	/** Metrics the server ships on every cell, so switching costs no request. */
	const METRICS = [
		{ id: 'loadKwh', label: m.energy_consumption() },
		{ id: 'importKwh', label: m.statistics_series_import() },
		{ id: 'exportKwh', label: m.chart_exported() },
		{ id: 'productionKwh', label: m.energy_production() }
	] as const;
	type MetricId = (typeof METRICS)[number]['id'];

	let metric = $state<MetricId>('loadKwh');
	let cells = $state<HeatmapCell[]>([]);

	$effect(() => {
		const query = { from: from.toISOString(), to: to.toISOString() };
		let cancelled = false;
		api.api.statistics.heatmap.get({ query }).then(({ data }) => {
			if (cancelled) return;
			cells = (data ?? []) as HeatmapCell[];
		});
		return () => {
			cancelled = true;
		};
	});

	/** One cell's average kWh for the selected metric. */
	const average = (c: HeatmapCell): number => (c.occurrences > 0 ? c[metric] / c.occurrences : 0);

	const points = $derived<HeatPoint[]>(
		cells.map((c) => ({ hod: c.hod, dow: c.dow, avg: average(c) }))
	);

	const peak = $derived(points.reduce<number>((max, p) => Math.max(max, p.avg), 0));
	// Two different emptinesses. No cells at all = the window has no history, and
	// the whole panel is decoration. Cells but a flat metric (a house that never
	// imported) = the grid has nothing to shade, but the panel must stay: the
	// metric switcher lives in its header, and hiding it strands the reader on a
	// choice they cannot undo without reloading.
	const hasCells = $derived(cells.length > 0);
	const hasData = $derived(peak > 0);

	/** Busiest slot — the sentence a screen reader gets instead of the grid. */
	const busiest = $derived(
		points.reduce<HeatPoint | null>((best, p) => (best && best.avg >= p.avg ? best : p), null)
	);

	// Only the weekdays the window actually covers. The server emits cells for
	// the (hour, weekday) slots that occurred, so a two-day window would
	// otherwise draw five labelled but permanently empty rows.
	const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
	const weekdays = $derived.by(() => {
		const present = new Set(cells.map((c) => c.dow));
		return ALL_WEEKDAYS.filter((d) => present.has(d));
	});

	const metricLabel = $derived(METRICS.find((x) => x.id === metric)?.label ?? '');
</script>

<!-- Nothing recorded in the window at all: an all-surface grid would be a
     decorative empty component. A flat metric inside a window that HAS data
     keeps the panel and swaps the grid for a line — see hasCells. -->
{#if hasCells}
	<section class="flex flex-col gap-3 border border-border p-4">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex min-w-0 flex-col">
				<h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
					{m.statistics_heatmap_title()}
				</h2>
				<p class="text-xs text-muted-foreground/70">{m.statistics_heatmap_caption()}</p>
			</div>
			<RangeSwitcher options={METRICS} bind:value={metric} />
		</div>

		{#if hasData}
			{#if busiest}
				<p class="sr-only">
					{m.statistics_heatmap_summary({
						metric: metricLabel,
						weekday: weekdayLabel(busiest.dow),
						hour: hourLabel(busiest.hod),
						amount: heatKwh(busiest.avg)
					})}
				</p>
			{/if}
			<HeatGrid {points} {peak} {weekdays} {metricLabel} />
		{:else}
			<!-- A metric this house never moved in this window. Say so, and keep the
			     switcher above it rather than unmounting the panel the reader chose
			     the metric from. -->
			<p class="py-6 text-center text-sm text-muted-foreground">
				{m.statistics_heatmap_metric_empty({ metric: metricLabel })}
			</p>
		{/if}
	</section>
{/if}
