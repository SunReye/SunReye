<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import HourlyBarChart from './hourly-bar-chart.svelte';
	import { api } from '$lib/api';
	import { COST_X_TICKS } from '$lib/cost/ranges';
	import * as m from '$lib/paraglide/messages';

	// One hour of the provider-agnostic solar forecast (apps/server/src/solar-forecast.ts).
	type ForecastHour = { time: string; watts: number };
	// The one field of today's hourly energy this dialog reads (server PeriodEnergy).
	type Period = { bucket: string; productionKwh: number };

	let {
		hourly,
		todayKwh,
		remainingTodayKwh,
		next15,
		triggerClass,
		trigger
	}: {
		hourly: ForecastHour[];
		todayKwh: number;
		remainingTodayKwh: number;
		/** Peak power (W) and energy (kWh) expected over the next 15 minutes. */
		next15: { maxPowerW: number; energyKwh: number };
		/** Weather-tile classes — the whole tile becomes the dialog trigger button. */
		triggerClass: string;
		/** Weather-tile content, rendered inside the trigger button. */
		trigger: Snippet;
	} = $props();

	const kwh = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
	const kw = (w: number) => (w / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });

	let open = $state(false);
	// Actual hourly production for today (kWh/hour); null until the first fetch
	// resolves. Only spans past hours (query is [today, now)).
	let actual = $state<Period[] | null>(null);

	// Guards against out-of-order responses: only the latest request may land.
	let seq = 0;
	async function loadActual() {
		const id = ++seq;
		const now = new Date();
		const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const { data } = await api.api.energy.series.get({
			query: { from: from.toISOString(), to: now.toISOString(), bucket: 'hour' }
		});
		if (id === seq) actual = (data ?? []) as Period[];
	}

	// Prime once at mount so the first open paints the actual bars instantly
	// instead of waiting on the series query.
	void loadActual();

	// Refresh on every open (stale bars otherwise outlive the first open) and
	// keep refreshing while the dialog stays open on a long-lived display.
	$effect(() => {
		if (!open) return;
		void loadActual();
		const refresh = setInterval(loadActual, 5 * 60 * 1000);
		return () => clearInterval(refresh);
	});

	// Mounting the bar chart is by far the heaviest part of opening the dialog;
	// doing it inside the click's task freezes the page before anything paints.
	// Deferring it two frames lets the dialog shell render first, then the chart
	// fills its placeholder.
	let chartReady = $state(false);
	$effect(() => {
		if (!open) {
			chartReady = false;
			return;
		}
		let raf = requestAnimationFrame(() => {
			raf = requestAnimationFrame(() => {
				chartReady = true;
			});
		});
		return () => cancelAnimationFrame(raf);
	});

	// Actual production keyed by hour-of-day (0–23) so it merges onto the forecast.
	const actualByHour = $derived.by(() => {
		const map = new Map<number, number>();
		for (const p of actual ?? []) {
			const h = Number(p.bucket.slice(11, 13));
			if (!Number.isNaN(h)) map.set(h, (map.get(h) ?? 0) + p.productionKwh);
		}
		return map;
	});
	const actualTotal = $derived((actual ?? []).reduce((s, p) => s + p.productionKwh, 0));

	// The forecast spans today + tomorrow; the chart shows today only. Predicted
	// energy per hour ≈ average power over the hour → watts/1000 kWh, directly
	// comparable to the measured production. Today is the date of the first hour.
	const today = $derived(hourly[0]?.time.slice(0, 10) ?? '');
	const data = $derived(
		hourly
			.filter((h) => h.time.startsWith(today))
			.map((h) => {
				const hour = Number(h.time.slice(11, 13));
				return {
					label: `${h.time.slice(11, 13)}:00`,
					predicted: h.watts / 1000,
					actual: actualByHour.get(hour) ?? 0
				};
			})
	);

	type Row = { predicted: number; actual: number };
	// Overlaid on the same band: a translucent predicted bar behind (drawn first)
	// and the solid measured actual in front. Actual is only present up to the
	// current hour, so past hours compare the two and future hours show the
	// forecast alone.
	const series = [
		{
			key: 'predicted',
			label: m.weather_forecast_predicted(),
			color: 'color-mix(in srgb, var(--color-energy-export) 35%, transparent)',
			value: (d: Row) => d.predicted
		},
		{
			key: 'actual',
			label: m.weather_forecast_actual(),
			color: 'var(--color-energy-solar)',
			value: (d: Row) => d.actual
		}
	];
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger class={triggerClass}>
		{@render trigger()}
	</Dialog.Trigger>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{m.weather_forecast_title()}</Dialog.Title>
		</Dialog.Header>
		<div class="flex min-w-0 flex-col gap-3">
			<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
				<span>
					{m.weather_forecast_actual()}
					<span class="font-semibold tabular-nums text-foreground">{kwh(actualTotal)} kWh</span>
				</span>
				<span>
					{m.weather_forecast_today()}
					<span class="font-semibold tabular-nums text-foreground">{kwh(todayKwh)} kWh</span>
				</span>
				<span>
					{m.weather_forecast_remaining()}
					<span class="font-semibold tabular-nums text-foreground">
						{kwh(remainingTodayKwh)} kWh
					</span>
				</span>
				<span>
					{m.weather_forecast_next15()}
					<span class="font-semibold tabular-nums text-foreground">
						{kw(next15.maxPowerW)} kW · {kwh(next15.energyKwh)} kWh
					</span>
				</span>
			</div>
			{#if chartReady}
				<HourlyBarChart
					{data}
					{series}
					unit="kWh"
					layout="overlap"
					xTicks={COST_X_TICKS.hour}
					empty={m.overview_no_data_today()}
				/>
			{:else}
				<!-- Same height as the chart (+ legend row) so the dialog doesn't jump. -->
				<div class="h-64" aria-hidden="true"></div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
