<script lang="ts">
	import { fade } from 'svelte/transition';
	import type { CostBreakdown } from 'server/src/cost-calc';
	import * as m from '$lib/paraglide/messages';
	import CostBarChart from '$lib/components/inverter/cost-bar-chart.svelte';
	import EnergySplitChart from '$lib/components/inverter/energy-split-chart.svelte';
	import RangeSwitcher from '$lib/components/inverter/range-switcher.svelte';
	import { api } from '$lib/api';
	import { costFormatters } from '$lib/cost/format';
	import { chartSpecFor, type ChartScope, type CostBucket, type CostRange } from '$lib/cost/ranges';
	import { chartCaption, defaultChartScope, scopeOptions } from '$lib/statistics/chart-scope';
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

	// Content of the cost section: registry tiles, the cost bars at the viewer's
	// chosen scope, and the tariff-band breakdown. The tiles payload is fetched by
	// the page (one window, shared with the other sections); the bar series is
	// this section's own, because only this section's scope switcher moves it.
	let { cost, range }: { cost: CostBreakdown; range: CostRange } = $props();

	// Ephemeral per-viewer choice, seeded from the saved preference.
	let scope = $state<ChartScope>(defaultChartScope('cost'));
	const spec = $derived(chartSpecFor(range, scope));
	const caption = $derived(chartCaption(range, scope));

	// Points + the granularity they were fetched at, updated together so the
	// chart never labels stale points with a freshly-picked bucket.
	let series = $state<{ points: SeriesPoint[]; bucket: CostBucket }>({
		points: [],
		bucket: 'day'
	});

	// `cancelled` guards against an earlier request resolving after a later one
	// and clobbering fresher data.
	$effect(() => {
		const query = { from: spec.from.toISOString(), to: spec.to.toISOString(), bucket: spec.bucket };
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
	<section class="flex flex-col gap-3 border border-border p-4" transition:fade={{ duration: 200 }}>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
				{m.costs_total_cost()} — {caption}
			</h2>
			<RangeSwitcher options={scopeOptions(range)} bind:value={scope} />
		</div>
		<CostBarChart points={series.points} bucket={series.bucket} currency={cost.currency} />
	</section>
{/if}

<!-- Energy split (grid-vs-solar, self-consumed-vs-exported), same scope as above.
     Owns its own section + fade and hides itself when the window has no energy. -->
<EnergySplitChart chart={spec} {caption} />

<!-- Import by band -->
<BandBreakdown title={m.costs_import_by_band()} rows={bandRows} />
