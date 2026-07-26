<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import ForecastChart, { type ForecastSlot } from './forecast-chart.svelte';
	import { api } from '$lib/api';
	import { inverter } from '$lib/inverter/store.svelte';
	import * as m from '$lib/paraglide/messages';

	// One slot of the provider-agnostic solar forecast (apps/server/src/solar-forecast.ts).
	type ForecastPoint = { time: string; watts: number; peakWatts: number };
	// The one field of today's hourly energy the fallback path reads (server PeriodEnergy).
	type Period = { bucket: string; productionKwh: number };

	let {
		series,
		rawSeries = [],
		stepMinutes,
		todayKwh,
		remainingTodayKwh,
		next15,
		triggerClass,
		trigger
	}: {
		series: ForecastPoint[];
		/** Uncurtailed PV potential over the same slots; equals `series` when nothing clips. */
		rawSeries?: ForecastPoint[];
		/** Forecast slot width in minutes (15 for Open-Meteo). */
		stepMinutes: number;
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

	// Mounting the bar chart is by far the heaviest part of opening the dialog
	// (~96 bands × 2 series churn through layerchart's reactive context even in
	// the canvas render path); doing it inside the click's task freezes the page
	// before anything paints. Deferring it two frames lets the dialog shell and
	// stat tiles render first, then the chart fills its placeholder.
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

	// ── Slot grid (plant-local day at the forecast's resolution) ─────────────
	const step = $derived(Math.max(1, stepMinutes || 60));
	const slotsPerDay = $derived(Math.ceil(1440 / step));
	// Today is the date of the first forecast slot; the forecast spans
	// today + tomorrow but the chart shows today only.
	const today = $derived(series[0]?.time.slice(0, 10) ?? '');
	const slotIndex = (hh: number, mm: number) => Math.floor((hh * 60 + mm) / step);
	const slotLabel = (i: number) => {
		const t = i * step;
		return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
	};

	// Measured production per slot: average + peak W, null where not measured
	// yet. Filled from minute rollups of the PV power metric; falls back to the
	// hourly energy split (no peaks) for profiles without a pv.total.power role.
	type Actual = { avgW: (number | null)[]; peakW: (number | null)[] };
	let actual = $state<Actual | null>(null);

	// The PV power metric is resolved from the *unfiltered* catalog: hiding the
	// sensor from dashboards shouldn't silently degrade this chart.
	const pvKey = $derived(inverter.allMetrics.find((mt) => mt.role === 'pv.total.power')?.key);

	const emptyColumn = () => Array.from({ length: slotsPerDay }, (): number | null => null);

	// ── Preferred path: minute rollups of the PV power metric ────────────────
	type Rollup = { time: string; avg: number; max: number };

	/** Bucket minute rollups into each slot's mean and peak W. */
	function fromRollups(rows: Rollup[]): Actual {
		const acc = Array.from({ length: slotsPerDay }, () => ({
			sum: 0,
			count: 0,
			peak: null as number | null
		}));
		for (const r of rows) {
			const d = new Date(r.time);
			// An out-of-range slot index simply misses the array.
			const a = acc[slotIndex(d.getHours(), d.getMinutes())];
			if (!a) continue;
			a.sum += r.avg;
			a.count += 1;
			a.peak = Math.max(a.peak ?? 0, r.max);
		}
		return {
			avgW: acc.map((a) => (a.count > 0 ? a.sum / a.count : null)),
			peakW: acc.map((a) => a.peak)
		};
	}

	// ── Fallback: hourly energy split, for profiles with no pv.total.power ────

	/** Spread one hour's average W across that hour's slots, stopping at `lastIdx`. */
	function fillHour(avgW: (number | null)[], hour: number, lastIdx: number, watts: number) {
		const first = slotIndex(hour, 0);
		for (let i = first; i < first + 60 / step && i <= lastIdx; i++) avgW[i] = watts;
	}

	/**
	 * kWh over one hour ⇒ average W. Capped at the running slot so the rest of the
	 * day stays forecast-only. No peaks are available on this path.
	 */
	function fromHourlyEnergy(rows: Period[], nowIdx: number): Actual {
		const avgW = emptyColumn();
		for (const p of rows) {
			const h = Number(p.bucket.slice(11, 13));
			if (Number.isNaN(h)) continue;
			fillHour(avgW, h, nowIdx, p.productionKwh * 1000);
		}
		return { avgW, peakW: emptyColumn() };
	}

	async function fetchRollups(metric: string, from: Date, to: Date): Promise<Actual> {
		const { data } = await api.api.history.rollup.get({
			query: {
				metric,
				from: from.toISOString(),
				to: to.toISOString(),
				bucket: 'minute',
				limit: 1600
			}
		});
		return fromRollups((data ?? []) as Rollup[]);
	}

	async function fetchHourlyEnergy(from: Date, to: Date, nowIdx: number): Promise<Actual> {
		const { data } = await api.api.energy.series.get({
			query: { from: from.toISOString(), to: to.toISOString(), bucket: 'hour' }
		});
		return fromHourlyEnergy((data ?? []) as Period[], nowIdx);
	}

	// Guards against out-of-order responses: only the latest request may land.
	let seq = 0;
	async function loadActual() {
		const id = ++seq;
		const now = new Date();
		const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const next = pvKey
			? await fetchRollups(pvKey, from, now)
			: await fetchHourlyEnergy(from, now, slotIndex(now.getHours(), now.getMinutes()));
		if (id !== seq) return;
		actual = next;
	}

	// Prime once at mount so the first open paints the measured bars instantly
	// instead of waiting on the query.
	void loadActual();

	// Refresh on every open (stale bars otherwise outlive the first open) and
	// keep refreshing while the dialog stays open on a long-lived display.
	$effect(() => {
		if (!open) return;
		void loadActual();
		const refresh = setInterval(loadActual, 5 * 60 * 1000);
		return () => clearInterval(refresh);
	});

	// Measured series padded to the slot grid, so slot assembly needs no guards.
	const measured = $derived<Actual>(actual ?? { avgW: [], peakW: [] });

	const actualTotalKwh = $derived(
		measured.avgW.reduce((s: number, w) => s + ((w ?? 0) * step) / 60 / 1000, 0)
	);

	/** The day's slots with the measured series filled in and no forecast yet. */
	function baseSlots(): ForecastSlot[] {
		return Array.from({ length: slotsPerDay }, (_, i) => ({
			label: slotLabel(i),
			predictedW: 0,
			predictedPeakW: 0,
			predictedRawW: 0,
			predictedRawPeakW: 0,
			actualW: measured.avgW[i] ?? null,
			actualPeakW: measured.peakW[i] ?? null
		}));
	}

	/** The slot a forecast point belongs to, or `undefined` if it isn't today's. */
	function slotOf(out: ForecastSlot[], p: ForecastPoint) {
		if (!p.time.startsWith(today)) return undefined;
		return out[slotIndex(Number(p.time.slice(11, 13)), Number(p.time.slice(14, 16)))];
	}

	function fillPredicted(out: ForecastSlot[], points: ForecastPoint[]) {
		for (const p of points) {
			const slot = slotOf(out, p);
			if (!slot) continue;
			slot.predictedW = p.watts;
			slot.predictedPeakW = p.peakWatts;
			// The raw view falls back to the usable one so a missing series
			// simply hides the uncapped split instead of drawing zeros.
			slot.predictedRawW = p.watts;
			slot.predictedRawPeakW = p.peakWatts;
		}
	}

	function fillRaw(out: ForecastSlot[], points: ForecastPoint[]) {
		for (const p of points) {
			const slot = slotOf(out, p);
			if (!slot) continue;
			slot.predictedRawW = p.watts;
			slot.predictedRawPeakW = p.peakWatts;
		}
	}

	const slots = $derived.by<ForecastSlot[]>(() => {
		const out = baseSlots();
		fillPredicted(out, series);
		fillRaw(out, rawSeries);
		return out;
	});

	// `sub` is always present so the tile markup needs a single truthiness test.
	const stats = $derived([
		{ label: m.weather_forecast_actual(), value: `${kwh(actualTotalKwh)} kWh`, sub: '' },
		{ label: m.weather_forecast_today(), value: `${kwh(todayKwh)} kWh`, sub: '' },
		{ label: m.weather_forecast_remaining(), value: `${kwh(remainingTodayKwh)} kWh`, sub: '' },
		{
			label: m.weather_forecast_next15(),
			value: `${kw(next15.maxPowerW)} kW`,
			sub: `${kwh(next15.energyKwh)} kWh`
		}
	]);
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger class={triggerClass}>
		{@render trigger()}
	</Dialog.Trigger>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{m.weather_forecast_title()}</Dialog.Title>
		</Dialog.Header>
		<div class="flex min-w-0 flex-col gap-4">
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{#each stats as s (s.label)}
					<div class="flex flex-col gap-0.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
						<span class="truncate text-[0.6rem] uppercase tracking-wide text-muted-foreground">
							{s.label}
						</span>
						<span class="text-sm font-semibold tabular-nums">
							{s.value}
							{#if s.sub}
								<span class="font-normal text-muted-foreground">· {s.sub}</span>
							{/if}
						</span>
					</div>
				{/each}
			</div>
			{#if chartReady}
				<ForecastChart {slots} stepMinutes={step} empty={m.overview_no_data_today()} />
			{:else}
				<!-- Same height as the chart (+ legend row) so the dialog doesn't jump. -->
				<div class="h-77" aria-hidden="true"></div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
