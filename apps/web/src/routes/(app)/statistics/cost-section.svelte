<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import CostBarChart from '$lib/components/inverter/cost-bar-chart.svelte';
	import { api } from '$lib/api';
	import { costFormatters } from '$lib/cost/format';
	import { specQuery, type CostBucket } from '$lib/cost/ranges';
	import type { SectionData } from '$lib/statistics/sections';
	import { sectionScope } from '$lib/statistics/chart-scope.svelte';
	import { baselineLabel, deltaFor } from '$lib/statistics/compare';
	import { statisticsLive } from '$lib/statistics-live.svelte';
	import { COST_TILES } from '$lib/statistics/tiles';
	import ChartPanel from './chart-panel.svelte';
	import StatTiles from './stat-tiles.svelte';
	import BandBreakdown from './band-breakdown.svelte';

	// One bar of the contextual chart. Mirrors the server's CostSeriesPoint.
	type SeriesPoint = {
		bucket: string;
		importCost: number;
		exportEarnings: number;
		standingCharge: number;
		net: number;
	};

	// Content of the cost section: registry tiles, the cost bars at the viewer's
	// chosen scope, and the tariff-band breakdown. The tiles payload is fetched by
	// the page (one window, shared with the other sections); the bar series is
	// this section's own, because only this section's scope switcher moves it.
	// Props are the shared bag every section body takes, so section-body can map
	// an id straight onto a component.
	let { data }: { data: SectionData } = $props();
	const cost = $derived(data.cost);
	const range = $derived(data.range);
	// Every tile carries its change against the reference window, named so the
	// arrow means something ("▼ 18% versus yesterday").
	const baseline = $derived(baselineLabel(data.mode, data.windowDays));

	// Ephemeral per-viewer choice, seeded from the saved preference.
	const view = sectionScope('cost', () => range);

	// Points + the granularity they were fetched at, updated together so the
	// chart never labels stale points with a freshly-picked bucket.
	let series = $state<{ points: SeriesPoint[]; bucket: CostBucket }>({
		points: [],
		bucket: 'day'
	});

	// `cancelled` guards against an earlier request resolving after a later one
	// and clobbering fresher data.
	$effect(() => {
		// Shared invalidation signal: a live push on a now-inclusive wider range
		// bumps it (at most once a minute), which refetches these bars in place.
		void statisticsLive.revision;
		const query = specQuery(view.spec);
		let cancelled = false;
		api.api.cost.series.get({ query }).then(({ data: payload }) => {
			if (cancelled) return;
			series = { points: (payload ?? []) as SeriesPoint[], bucket: query.bucket };
		});
		return () => {
			cancelled = true;
		};
	});

	const formatters = $derived(costFormatters(cost.currency));

	// Hide the cost chart entirely when every period is zero (no spend, no earnings,
	// no standing) — matches the "don't render empty components" rule. Checked per
	// component so a period where earnings exactly cancel costs (net 0) still shows.
	const costHasData = $derived(
		series.points.some((p) => p.importCost !== 0 || p.exportEarnings !== 0 || p.net !== 0)
	);

	// The chart header restates the window's net cost, so the comparison follows
	// the reader past the tile row.
	const summary = $derived({
		value: formatters.money(cost.net),
		delta: deltaFor(cost.net, data.previous?.net ?? null),
		goodDirection: 'down' as const,
		baseline
	});

	// Import split by tariff band, pre-formatted for the breakdown section.
	const bandRows = $derived(
		cost.byBand.map((b) => ({
			name: b.name,
			energy: formatters.kwh(b.importKwh),
			cost: formatters.money(b.cost)
		}))
	);
</script>

<!-- Headline tiles -->
<StatTiles
	defs={COST_TILES}
	data={cost}
	previous={data.previous}
	{baseline}
	{formatters}
/>

<!-- Total-cost bars. Window/granularity follow this section's scope switcher,
     independent of the tiles above and of the other sections' charts. -->
{#if costHasData}
	<ChartPanel title={m.costs_total_cost()} {view} switcher={range} {summary}>
		<CostBarChart points={series.points} bucket={series.bucket} currency={cost.currency} />
	</ChartPanel>
{/if}

<!-- Import by band -->
<BandBreakdown title={m.costs_import_by_band()} rows={bandRows} />
