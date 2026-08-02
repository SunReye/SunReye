<script lang="ts">
	import type { CostBreakdown } from 'server/src/cost-calc';
	import * as m from '$lib/paraglide/messages';
	import CostBarChart from '$lib/components/inverter/cost-bar-chart.svelte';
	import { api } from '$lib/api';
	import { costFormatters } from '$lib/cost/format';
	import { specQuery, type CostBucket, type CostRange } from '$lib/cost/ranges';
	import { sectionScope } from '$lib/statistics/chart-scope.svelte';
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
	let { cost, range }: { cost: CostBreakdown; range: CostRange } = $props();

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
		const query = specQuery(view.spec);
		let cancelled = false;
		api.api.cost.series.get({ query }).then(({ data }) => {
			if (cancelled) return;
			series = { points: (data ?? []) as SeriesPoint[], bucket: query.bucket };
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
<StatTiles defs={COST_TILES} data={cost} {formatters} />

<!-- Total-cost bars. Window/granularity follow this section's scope switcher,
     independent of the tiles above and of the other sections' charts. -->
{#if costHasData}
	<ChartPanel title={m.costs_total_cost()} {view} {range} switcher>
		<CostBarChart points={series.points} bucket={series.bucket} currency={cost.currency} />
	</ChartPanel>
{/if}

<!-- Import by band -->
<BandBreakdown title={m.costs_import_by_band()} rows={bandRows} />
