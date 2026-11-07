<script lang="ts">
	import SolarForecastDialog from './solar-forecast-dialog.svelte';

	let { stepMinutes = 60 }: { stepMinutes?: number } = $props();
</script>

<SolarForecastDialog
	series={[{ time: '2026-11-07T12:00', watts: 1000, peakWatts: 1200 }]}
	{stepMinutes}
	todayKwh={9}
	remainingTodayKwh={4}
	next15={{ maxPowerW: 1200, avgPowerW: 1000, energyKwh: 0.25 }}
	triggerClass="weather-tile"
>
	{#snippet trigger()}Forecast{/snippet}
</SolarForecastDialog>
