<script lang="ts">
	import type { SpotPriceView } from 'server/src/spot-price-job';
	import { api } from '$lib/api';
	import { costFormatters } from '$lib/cost/format';
	import type { SectionData } from '$lib/statistics/sections';
	import { historySince, historyWindows } from '$lib/statistics/price-history';
	import { spotStats } from '$lib/statistics/spot-stats.svelte';
	import { statisticsLive } from '$lib/statistics-live.svelte';
	import { statisticsPrefs } from '$lib/statistics-prefs.svelte';
	import { PRICE_TILES } from '$lib/statistics/tiles';
	import NegativeWindowHistory from './negative-window-history.svelte';
	import PriceCurves from './price-curves.svelte';
	import PriceWhatIf from './price-whatif.svelte';
	import StatTiles from './stat-tiles.svelte';

	const DAY_MS = 86_400_000;

	// Spot price analytics. Two sources, deliberately: the market's *behaviour*
	// over the picked window comes from /api/statistics/prices (fetched by the
	// section list, which also needs it to decide this section exists at all),
	// while the curves at the top are the forward-looking day-ahead slice from
	// /api/prices — today and tomorrow, whatever range the page is on.
	let { data }: { data: SectionData } = $props();
	const range = $derived(data.range);

	const stats = $derived(spotStats.stats);

	// The day-ahead window is always "today and tomorrow", so unlike the analytics
	// above there is no range to re-fetch on — the only thing that changes the
	// answer is a spot-price sync, which the live stream signals. Without that
	// signal this is the one-shot load it looks like.
	let view = $state<SpotPriceView | null>(null);
	$effect(() => {
		void statisticsLive.priceRevision;
		let cancelled = false;
		void api.api.prices.get().then(({ data: payload }) => {
			if (!cancelled) view = (payload as SpotPriceView | null) ?? null;
		});
		return () => {
			cancelled = true;
		};
	});

	// How far back the history list reaches: the saved preference, clamped to the
	// picked window so the list never claims to cover time the window excludes.
	const sinceMs = $derived(
		historySince(range.from, range.to, statisticsPrefs.optionFor('prices').windowDays)
	);
	const historyDays = $derived(Math.max(1, Math.round((range.to.getTime() - sinceMs) / DAY_MS)));
	// Market-local, like the curves above — the day-ahead payload is where the
	// market's offset comes from.
	const history = $derived(
		stats && view ? historyWindows(stats.negativeWindows, sinceMs, view.utcOffsetSeconds) : []
	);

	const formatters = $derived(costFormatters(stats?.currency));
</script>

{#if stats}
	<StatTiles defs={PRICE_TILES} data={stats} {formatters} />

	{#if view}
		<PriceCurves {view} />
	{/if}

	<NegativeWindowHistory
		windows={history}
		days={historyDays}
		truncated={stats.negativeWindowsTruncated}
	/>

	<!-- Only when the window actually holds market prices to reprice against. -->
	{#if stats.whatIf}
		<PriceWhatIf whatIf={stats.whatIf} {formatters} />
	{/if}
{/if}
