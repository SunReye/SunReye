<script lang="ts">
	// The weather tile's right-hand figures. Expected PV production replaces the raw
	// radiation sum whenever the plant is configured, so this renders whichever of
	// the two the payload supports — or nothing.
	//
	// Pinned right only once it shares the tile's row at lg; below that it sits on
	// its own row. All structural nodes are spans so the interactive tile variant
	// stays a valid <button>.
	import * as m from '$lib/paraglide/messages';
	import type { SolarForecast } from './weather';

	let {
		forecast,
		radiationText
	}: {
		forecast: SolarForecast | null;
		/** Pre-formatted radiation sum, or null when the payload has none. */
		radiationText: string | null;
	} = $props();

	const kwh = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
</script>

{#if forecast}
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
			<span
				class="text-lg font-medium tabular-nums leading-tight text-muted-foreground 2xl:text-xl"
			>
				{kwh(forecast.tomorrowKwh)}
				<span class="text-xs font-normal">kWh</span>
			</span>
			<span class="text-[0.6rem] uppercase tracking-wide text-muted-foreground">
				{m.weather_forecast_tomorrow()}
			</span>
		</span>
	</span>
{:else if radiationText !== null}
	<span class="flex shrink-0 flex-col items-start lg:ml-auto lg:items-end">
		<span class="text-sm font-medium tabular-nums 2xl:text-base">
			{radiationText}
		</span>
		<span class="text-[0.6rem] uppercase tracking-wide text-muted-foreground">
			{m.weather_solar_sum()}
		</span>
	</span>
{/if}
