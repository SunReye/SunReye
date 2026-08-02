<script lang="ts">
	import { fade } from 'svelte/transition';
	import type { CostBreakdown } from 'server/src/cost-calc';
	import { api } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import CostRangePicker from '$lib/components/inverter/cost-range-picker.svelte';
	import { setPageHeader } from '$lib/page-header.svelte';
	import CostBarChart from '$lib/components/inverter/cost-bar-chart.svelte';
	import EnergySplitChart from '$lib/components/inverter/energy-split-chart.svelte';
	import { resolveCostPreset, type CostBucket, type CostRange } from '$lib/cost/ranges';
	import { costFormatters } from '$lib/cost/format';
	import CostTiles from './cost-tiles.svelte';
	import BandBreakdown from './band-breakdown.svelte';
	import PricePanel from '$lib/components/prices/price-panel.svelte';

	// One bar of the contextual chart. Mirrors the server's CostSeriesPoint.
	type SeriesPoint = {
		bucket: string;
		importCost: number;
		exportEarnings: number;
		standingCharge: number;
		net: number;
	};

	let range = $state<CostRange>(resolveCostPreset('month'));
	let cost = $state<CostBreakdown | null>(null);
	let loading = $state(true);
	// Points + the granularity they were fetched at, updated together so the
	// chart never labels stale points with a freshly-picked bucket.
	let series = $state<{ points: SeriesPoint[]; bucket: CostBucket }>({
		points: [],
		bucket: 'day'
	});

	// Headline tiles: priced over the picked [from, to). `cancelled` guards against
	// an earlier request resolving after a later one and clobbering fresher data.
	$effect(() => {
		const from = range.from.toISOString();
		const to = range.to.toISOString();
		let cancelled = false;
		loading = true;
		api.api.cost.get({ query: { from, to } }).then(({ data }) => {
			if (cancelled) return;
			cost = (data as CostBreakdown) ?? null;
			loading = false;
		});
		return () => {
			cancelled = true;
		};
	});

	// Contextual bar chart: its own "one level up" window/granularity (range.chart),
	// e.g. a single month charts the trailing 12 months.
	$effect(() => {
		const spec = range.chart;
		const query = { from: spec.from.toISOString(), to: spec.to.toISOString(), bucket: spec.bucket };
		let cancelled = false;
		api.api.cost.series.get({ query }).then(({ data }) => {
			if (cancelled) return;
			series = { points: (data ?? []) as SeriesPoint[], bucket: spec.bucket };
		});
		return () => {
			cancelled = true;
		};
	});

	// Hide the cost chart entirely when every period is zero (no spend, no earnings,
	// no standing) — matches the "don't render empty components" rule. Checked per
	// component so a period where earnings exactly cancel costs (net 0) still shows.
	const costHasData = $derived(
		series.points.some((p) => p.importCost !== 0 || p.exportEarnings !== 0 || p.net !== 0)
	);

	// Formatters pinned to the fetched breakdown's currency (EUR until it loads).
	const { money, kwh, pct, price } = $derived(costFormatters(cost?.currency));

	/** Tiles turn green only when the figure is in the household's favour. */
	const goodIf = (favourable: boolean) => (favourable ? 'text-emerald-500' : '');

	// Solar Saving breakdown: self-consumed kWh × effective grid price = saving.
	// The effective price is the saving spread over the self-consumed energy, so
	// it stays band-accurate without the server returning a separate price.
	const solarSavingBreakdown = $derived.by(() => {
		if (!cost || cost.selfConsumedKwh <= 0) return null;
		return `${kwh(cost.selfConsumedKwh)} × ${price(cost.solarSavings / cost.selfConsumedKwh)}`;
	});

	// The headline tiles, fully formatted so the grid stays pure presentation.
	const tiles = $derived.by(() => {
		const c = cost;
		if (!c) return [];
		return [
			{
				id: 'gridCost',
				label: m.costs_tile_grid_cost(),
				value: money(c.importCost + c.standingCharge),
				sub: m.costs_sub_grid_cost({
					imported: money(c.importCost),
					standing: money(c.standingCharge)
				}),
				accent: '',
				explain: m.costs_tile_grid_cost_explain()
			},
			// Only once §51 has actually cost something: on a plant that never opted
			// in, or a day with no negative slots, the tile would be a permanent zero.
			...(c.zeroValueExportKwh > 0
				? [
						{
							id: 'zeroValueExport',
							label: m.costs_tile_zero_value(),
							value: kwh(c.zeroValueExportKwh),
							sub: m.costs_sub_zero_value({ amount: money(c.zeroValueExportEur) }),
							accent: '',
							explain: m.costs_tile_zero_value_explain()
						}
					]
				: []),
			{
				id: 'effectiveCost',
				label: m.costs_tile_effective_cost(),
				value: money(c.net),
				sub: m.costs_sub_effective_cost({ amount: money(c.exportEarnings) }),
				accent: goodIf(c.net < 0),
				explain: m.costs_tile_effective_cost_explain()
			},
			{
				id: 'gridImport',
				label: m.costs_tile_grid_import(),
				value: money(c.importCost),
				sub: m.costs_sub_grid_import({ energy: kwh(c.importKwh) }),
				accent: '',
				explain: m.costs_tile_grid_import_explain()
			},
			{
				id: 'gridExport',
				label: m.costs_tile_grid_export(),
				value: money(c.exportEarnings),
				sub: m.costs_sub_grid_export({ energy: kwh(c.exportKwh) }),
				accent: goodIf(c.exportEarnings > 0),
				explain: m.costs_tile_grid_export_explain()
			},
			{
				id: 'solarSaving',
				label: m.costs_tile_solar_saving(),
				value: money(c.solarSavings),
				sub: solarSavingBreakdown ?? m.costs_sub_self_consumed(),
				accent: goodIf(c.solarSavings > 0),
				explain: m.costs_tile_solar_saving_explain()
			},
			{
				id: 'totalSavings',
				label: m.costs_tile_total_savings(),
				value: money(c.savings),
				sub: m.costs_sub_total_savings({ amount: money(c.exportEarnings) }),
				accent: goodIf(c.savings > 0),
				explain: m.costs_tile_total_savings_explain()
			},
			{
				id: 'selfSufficiency',
				label: m.costs_tile_self_sufficiency(),
				value: pct(c.selfSufficiency),
				sub: m.costs_sub_self_sufficiency(),
				accent: '',
				explain: m.costs_tile_self_sufficiency_explain()
			},
			{
				id: 'selfConsumption',
				label: m.costs_tile_self_consumption(),
				value: pct(c.selfConsumption),
				sub: m.costs_sub_self_consumption(),
				accent: '',
				explain: m.costs_tile_self_consumption_explain()
			}
		];
	});

	// Import split by tariff band, pre-formatted for the breakdown section.
	const bandRows = $derived(
		(cost?.byBand ?? []).map((b) => ({
			name: b.name,
			energy: kwh(b.importKwh),
			cost: money(b.cost)
		}))
	);

	// Localized caption for the contextual charts, keyed by the picked preset id
	// (mirrors the English captions baked into $lib/cost/ranges). Falls back to the
	// range's own caption for any id without a dedicated message.
	const CAPTIONS: Record<string, () => string> = {
		today: m.costs_caption_today,
		'7d': m.costs_caption_last_7d,
		month: m.costs_caption_this_month,
		lastMonth: m.range_12mo,
		year: m.range_12mo,
		custom: m.costs_caption_custom
	};
	const caption = $derived(CAPTIONS[range.id]?.() ?? range.chart.caption);

	// First load only: once totals exist a range change refreshes them in place.
	const showLoader = $derived(loading && !cost);

	$effect(() => setPageHeader(m.nav_costs(), m.costs_subtitle()));
</script>

<div class="flex w-full flex-col gap-6 p-4 sm:p-6">
	<div class="flex flex-wrap items-center justify-end gap-3">
		<CostRangePicker bind:range />
	</div>

	{#if showLoader}
		<div class="flex h-40 items-center justify-center border border-border text-sm text-muted-foreground">
			{m.costs_loading()}
		</div>
	{:else if cost}
		<!-- Headline tiles -->
		<CostTiles {tiles} />

		<!-- Contextual total-cost bars. Window/granularity follow the picked range
		     "one level up" (range.chart), independent of the tiles above. -->
		{#if costHasData}
			<section
				class="flex flex-col gap-3 border border-border p-4"
				transition:fade={{ duration: 200 }}
			>
				<h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
					{m.costs_total_cost()} — {caption}
				</h2>
				<CostBarChart points={series.points} bucket={series.bucket} currency={cost.currency} />
			</section>
		{/if}

		<!-- Energy split (grid-vs-solar, self-consumed-vs-exported), same range as above.
		     Owns its own section + fade and hides itself when the range has no energy. -->
		<EnergySplitChart chart={range.chart} {caption} />

		<!-- Import by band -->
		<BandBreakdown title={m.costs_import_by_band()} rows={bandRows} />
	{/if}

	<!-- Day-ahead prices: forward-looking, so deliberately outside the range-driven
	     block above and outside the `cost` guard — it is worth seeing on a fresh
	     install with no priced history yet. Renders nothing when the feed is off. -->
	<PricePanel />
</div>
