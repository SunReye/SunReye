<script lang="ts">
	import type { BatteryHealth } from '@SunReye/contracts/energy';
	import BatteryHealthChart from '$lib/components/statistics/battery-health-chart.svelte';
	import ChartPanel from './chart-panel.svelte';
	import * as m from '$lib/paraglide/messages';

	// The degradation series, and the decision of whether there is one to show.
	// Its own component so the energy section's body stays a list of panels
	// rather than growing a branch per panel.
	let {
		health,
		hasBattery
	}: {
		health: BatteryHealth | null;
		/** The plant has a pack — the same gate the battery tiles carry. */
		hasBattery: boolean;
	} = $props();

	const trend = $derived(hasBattery ? (health?.trend ?? []) : []);

	// The nameplate, when health was measured against one, drawn as the reference
	// line. Read off the health figure rather than fetched separately, so there is
	// one source of truth for "is a nameplate stated".
	const nameplate = $derived(
		health?.health?.reference === 'nameplate' ? health.health.referenceKwh : null
	);
</script>

<!-- Rangeless entirely: capacity is measured per deep discharge, so this plots
     every measurement the pack has produced rather than the picked window. Two
     points is the floor — one measurement is not a trend, and the tile above
     already states the current figure. -->
{#if trend.length >= 2}
	<ChartPanel title={m.statistics_battery_health_trend()} caption={m.statistics_all_measurements()}>
		<BatteryHealthChart {trend} nameplateKwh={nameplate} />
	</ChartPanel>
{/if}
