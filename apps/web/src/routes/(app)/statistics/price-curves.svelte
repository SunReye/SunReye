<script lang="ts">
	import { onMount } from 'svelte';
	import type { SpotPriceView } from '@SunReye/contracts/prices';
	import * as m from '$lib/paraglide/messages';
	import * as Alert from '$lib/components/ui/alert';
	import PriceTrackChart from '$lib/components/prices/price-track-chart.svelte';
	import PriceNotes from '$lib/components/prices/price-notes.svelte';
	import { priceRows } from '$lib/prices/price-series';
	import { dayKeyDate, weekdayDate } from '$lib/format/date';
	import { dayCurves, nowBand } from '$lib/statistics/price-history';
	import ChartPanel from './chart-panel.svelte';

	/** How often the now-marker moves. A slot is 15 minutes; a minute is plenty. */
	const TICK_MS = 60_000;

	// The two day-ahead curves at the top of the price section, in their fixed
	// order: today first — the day you can still act on — then tomorrow directly
	// below it. Charts, never lists of times.
	let { view }: { view: SpotPriceView } = $props();

	let nowMs = $state(Date.now());
	onMount(() => {
		const timer = setInterval(() => (nowMs = Date.now()), TICK_MS);
		return () => clearInterval(timer);
	});

	const curves = $derived(dayCurves(priceRows(view)));
	const today = $derived(curves[0] ?? null);
	const tomorrow = $derived(curves[1] ?? null);
	const nowKey = $derived(today ? nowBand(today.rows, nowMs) : null);

	// An hourly source cannot resolve a negative quarter-hour inside a
	// net-positive hour, which is the whole §51 case, so it must be admitted —
	// next to the curves it qualifies, together with the source's credit line.
	const coarse = $derived(view.resolutionMinutes > 15);

	const dayLabel = (date: string) => weekdayDate(dayKeyDate(date));
</script>

{#if today}
	<ChartPanel title={m.statistics_prices_today()} caption={dayLabel(today.date)}>
		<PriceTrackChart rows={today.rows} {nowKey} />
	</ChartPanel>
{/if}

<!-- Tomorrow sits directly under today, published or not: before the auction
     clears, the note stands in for the curve so the slot never reads as an
     empty card. -->
{#if tomorrow}
	<ChartPanel title={m.statistics_prices_tomorrow()} caption={dayLabel(tomorrow.date)}>
		<PriceTrackChart rows={tomorrow.rows} />
	</ChartPanel>
{:else}
	<Alert.Root>
		<Alert.Description>{m.prices_tomorrow_pending()}</Alert.Description>
	</Alert.Root>
{/if}

<PriceNotes {coarse} attribution={view.attribution} />

