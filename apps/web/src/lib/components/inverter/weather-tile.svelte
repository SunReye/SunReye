<script lang="ts">
	import type { Component } from 'svelte';
	import Sun from 'phosphor-svelte/lib/Sun';
	import CloudSun from 'phosphor-svelte/lib/CloudSun';
	import Cloud from 'phosphor-svelte/lib/Cloud';
	import CloudFog from 'phosphor-svelte/lib/CloudFog';
	import CloudRain from 'phosphor-svelte/lib/CloudRain';
	import CloudSnow from 'phosphor-svelte/lib/CloudSnow';
	import CloudLightning from 'phosphor-svelte/lib/CloudLightning';
	import { api } from '$lib/api';
	import SolarForecastDialog from './solar-forecast-dialog.svelte';
	import WeatherTileBody from './_shared/weather-tile-body.svelte';
	import type { Weather } from './_shared/weather';

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

	const tempText = $derived(weather ? `${Math.round(weather.temperature)}${weather.unit}` : '');
	// With the forecast stats on the right the condition text would crowd the tile;
	// the icon already carries it.
	const condition = $derived(weather && !weather.forecast ? weather.condition : '');
	const place = $derived(weather?.label ?? '');

	const radiation = $derived(weather?.solarRadiationSum ?? null);
	const radiationText = $derived(
		radiation === null ? null : radiation.toLocaleString(undefined, { maximumFractionDigits: 1 })
	);

	const forecast = $derived(weather?.forecast ?? null);
	// Only offer the solar-forecast detail dialog when the plant is configured and
	// the provider returned an hourly series to chart.
	const chartable = $derived((forecast?.series?.length ?? 0) > 0 ? forecast : null);
	const rawSeries = $derived(chartable?.raw?.series ?? []);

	const ready = $derived(weather !== null && Icon !== null);

	// Card surface, shared by the interactive (dialog trigger) and static variants.
	const CARD_BASE =
		'flex h-full flex-col justify-center gap-3 rounded-xl border border-border/60 bg-card p-3 sm:p-4 lg:h-auto lg:flex-row lg:items-center lg:gap-4';
	const TRIGGER_CLASS = `${CARD_BASE} w-full text-left transition-colors hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`;
</script>

{#if ready}
	{#if chartable}
		<SolarForecastDialog
			series={chartable.series}
			{rawSeries}
			stepMinutes={chartable.stepMinutes}
			todayKwh={chartable.todayKwh}
			remainingTodayKwh={chartable.remainingTodayKwh}
			next15={chartable.next15}
			triggerClass={TRIGGER_CLASS}
		>
			{#snippet trigger()}
				<WeatherTileBody {Icon} {tempText} {condition} {place} {forecast} {radiationText} />
			{/snippet}
		</SolarForecastDialog>
	{:else}
		<!-- On lg the tile fills its column width (stretch) at its natural height so
		     the energy cards below take the remaining column height. -->
		<div class={CARD_BASE}>
			<WeatherTileBody {Icon} {tempText} {condition} {place} {forecast} {radiationText} />
		</div>
	{/if}
{/if}
