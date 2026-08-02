<script lang="ts">
	import type { CostBreakdown } from 'server/src/cost-calc';
	import { api } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import CostRangePicker from '$lib/components/inverter/cost-range-picker.svelte';
	import { setPageHeader } from '$lib/page-header.svelte';
	import { resolveCostPreset, type CostBucket, type CostRange } from '$lib/cost/ranges';
	import { SECTIONS } from '$lib/statistics/sections';
	import PricePanel from '$lib/components/prices/price-panel.svelte';
	import StatisticsSection from './statistics-section.svelte';
	import CostSection from './cost-section.svelte';

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

	// Only the cost section has content in this wave; later waves register
	// their sections here and the filter goes away.
	const activeSections = SECTIONS.filter((s) => s.id === 'cost');

	$effect(() => setPageHeader(m.nav_statistics(), m.statistics_subtitle()));
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
		<!-- Section loop over the registry; each entry renders inside the shared
		     collapsible shell. -->
		{#each activeSections as section (section.id)}
			<StatisticsSection title={section.label()} {caption}>
				<CostSection {cost} {series} chart={range.chart} {caption} />
			</StatisticsSection>
		{/each}
	{/if}

	<!-- Day-ahead prices: forward-looking, so deliberately outside the range-driven
	     block above and outside the `cost` guard — it is worth seeing on a fresh
	     install with no priced history yet. Renders nothing when the feed is off. -->
	<PricePanel />
</div>
