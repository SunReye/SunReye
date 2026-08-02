<script lang="ts">
	import { fade } from 'svelte/transition';
	import type { CostBreakdown } from 'server/src/cost-calc';
	import * as m from '$lib/paraglide/messages';
	import CostBarChart from '$lib/components/inverter/cost-bar-chart.svelte';
	import EnergySplitChart from '$lib/components/inverter/energy-split-chart.svelte';
	import { costFormatters } from '$lib/cost/format';
	import type { CostBucket, CostRange } from '$lib/cost/ranges';
	import { COST_TILES } from '$lib/statistics/tiles';
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

	// Content of the cost section: registry tiles, the contextual cost bars,
	// the energy split and the tariff-band breakdown. Fetching stays with the
	// page; this component only renders what it is given.
	let {
		cost,
		series,
		chart,
		caption
	}: {
		cost: CostBreakdown;
		series: { points: SeriesPoint[]; bucket: CostBucket };
		chart: CostRange['chart'];
		caption: string;
	} = $props();

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

<!-- Contextual total-cost bars. Window/granularity follow the picked range
     "one level up" (range.chart), independent of the tiles above. -->
{#if costHasData}
	<section class="flex flex-col gap-3 border border-border p-4" transition:fade={{ duration: 200 }}>
		<h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
			{m.costs_total_cost()} — {caption}
		</h2>
		<CostBarChart points={series.points} bucket={series.bucket} currency={cost.currency} />
	</section>
{/if}

<!-- Energy split (grid-vs-solar, self-consumed-vs-exported), same range as above.
     Owns its own section + fade and hides itself when the range has no energy. -->
<EnergySplitChart {chart} {caption} />

<!-- Import by band -->
<BandBreakdown title={m.costs_import_by_band()} rows={bandRows} />
