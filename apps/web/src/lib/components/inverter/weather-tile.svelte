<script lang="ts">
	import type { Component } from 'svelte';
	import Sun from 'phosphor-svelte/lib/Sun';
	import CloudSun from 'phosphor-svelte/lib/CloudSun';
	import Cloud from 'phosphor-svelte/lib/Cloud';
	import CloudFog from 'phosphor-svelte/lib/CloudFog';
	import CloudRain from 'phosphor-svelte/lib/CloudRain';
	import CloudSnow from 'phosphor-svelte/lib/CloudSnow';
	import CloudLightning from 'phosphor-svelte/lib/CloudLightning';
	import MapPin from 'phosphor-svelte/lib/MapPin';
	import { api } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import SolarForecastDialog from './solar-forecast-dialog.svelte';

	type SolarForecast = {
		provider: string;
		/** Slot width of `series` in minutes (15 for Open-Meteo). */
		stepMinutes: number;
		/** Expected avg/peak AC power per slot, plant-local (`YYYY-MM-DDTHH:mm`). */
		series: { time: string; watts: number; peakWatts: number }[];
		todayKwh: number;
		remainingTodayKwh: number;
		tomorrowKwh: number;
		next15: { maxPowerW: number; energyKwh: number };
	};

	type Weather = {
		temperature: number;
		unit: string;
		condition: string;
		icon: string;
		solarRadiationSum: number | null;
		label: string;
		forecast: SolarForecast | null;
	};

	const kwh = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });

	const ICONS: Record<string, Component> = {
		clear: Sun,
		'partly-cloudy': CloudSun,
		cloudy: Cloud,
		fog: CloudFog,
		drizzle: CloudRain,
		rain: CloudRain,
		snow: CloudSnow,
		thunder: CloudLightning
	};

	let weather = $state<Weather | null>(null);

	// Poll well within the server's 15-min cache; the server does the real
	// throttling so this just keeps a long-lived wall display fresh.
	$effect(() => {
		let stop = false;
		const load = async () => {
			const { data } = await api.api.weather.get();
			if (!stop) weather = (data as Weather | null) ?? null;
		};
		load();
		const id = setInterval(load, 10 * 60 * 1000);
		return () => {
			stop = true;
			clearInterval(id);
		};
	});

	const Icon = $derived(weather ? (ICONS[weather.icon] ?? Cloud) : null);

	// Only offer the solar-forecast detail dialog when the plant is configured and
	// the provider returned an hourly series to chart.
	const forecast = $derived(weather?.forecast ?? null);
	const hasForecastChart = $derived((forecast?.series?.length ?? 0) > 0);

	// Card surface, shared by the interactive (dialog trigger) and static variants.
	const CARD_BASE =
		'flex h-full flex-col justify-center gap-3 rounded-xl border border-border/60 bg-card p-3 sm:p-4 lg:h-auto lg:flex-row lg:items-center lg:gap-4';
	const TRIGGER_CLASS = `${CARD_BASE} w-full text-left transition-colors hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`;
</script>

<!-- The tile content is defined once and rendered either as a dialog trigger
     (when there's a forecast to chart) or as a plain, non-interactive card. All
     structural nodes are spans so the interactive variant is a valid <button>. -->
{#snippet body()}
	<!-- Icon + temperature/location stay grouped so the forecast can drop to its
	     own row below lg instead of colliding with the temperature at ~320px. -->
	<span class="flex min-w-0 items-center gap-4">
		<span class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 2xl:size-16">
			{#if Icon}
				<Icon class="size-7 text-primary 2xl:size-9" weight="duotone" />
			{/if}
		</span>
		<span class="flex min-w-0 flex-col gap-0.5">
			<span class="text-3xl font-semibold tabular-nums leading-none 2xl:text-4xl">
				{Math.round(weather?.temperature ?? 0)}{weather?.unit ?? ''}
			</span>
			<!-- With the forecast stats on the right the condition text would crowd
			     the tile; the icon already carries it. -->
			{#if weather && !weather.forecast}
				<span class="truncate text-sm text-muted-foreground">{weather.condition}</span>
			{/if}
			{#if weather?.label}
				<span class="flex items-center gap-1 truncate text-xs text-muted-foreground">
					<MapPin class="size-3 shrink-0" />
					{weather.label}
				</span>
			{/if}
		</span>
	</span>
	{#if forecast}
		<!-- Expected PV production (provider-agnostic server forecast) replaces
		     the raw radiation figure when the plant is configured. Pinned right
		     only once it shares the row at lg; below that it sits on its own row. -->
		<span class="flex shrink-0 items-center gap-4 lg:ml-auto 2xl:gap-6">
			<span class="flex flex-col items-end">
				<span class="text-lg font-semibold tabular-nums leading-tight 2xl:text-xl">
					{kwh(forecast.remainingTodayKwh)}
					<span class="text-xs font-normal text-muted-foreground">kWh</span>
				</span>
				<span class="text-[0.6rem] uppercase tracking-wide text-muted-foreground">
					{m.weather_forecast_remaining()}
				</span>
			</span>
			<span class="flex flex-col items-end">
				<span class="text-lg font-medium tabular-nums leading-tight text-muted-foreground 2xl:text-xl">
					{kwh(forecast.tomorrowKwh)}
					<span class="text-xs font-normal">kWh</span>
				</span>
				<span class="text-[0.6rem] uppercase tracking-wide text-muted-foreground">
					{m.weather_forecast_tomorrow()}
				</span>
			</span>
		</span>
	{:else if weather && weather.solarRadiationSum !== null}
		<span class="flex shrink-0 flex-col items-start lg:ml-auto lg:items-end">
			<span class="text-sm font-medium tabular-nums 2xl:text-base">
				{weather.solarRadiationSum.toLocaleString(undefined, { maximumFractionDigits: 1 })}
			</span>
			<span class="text-[0.6rem] uppercase tracking-wide text-muted-foreground">
				{m.weather_solar_sum()}
			</span>
		</span>
	{/if}
{/snippet}

{#if weather && Icon}
	{#if hasForecastChart && forecast}
		<SolarForecastDialog
			series={forecast.series}
			stepMinutes={forecast.stepMinutes}
			todayKwh={forecast.todayKwh}
			remainingTodayKwh={forecast.remainingTodayKwh}
			next15={forecast.next15}
			triggerClass={TRIGGER_CLASS}
		>
			{#snippet trigger()}
				{@render body()}
			{/snippet}
		</SolarForecastDialog>
	{:else}
		<!-- On lg the tile fills its column width (stretch) at its natural height so
		     the energy cards below take the remaining column height. -->
		<div class={CARD_BASE}>
			{@render body()}
		</div>
	{/if}
{/if}
