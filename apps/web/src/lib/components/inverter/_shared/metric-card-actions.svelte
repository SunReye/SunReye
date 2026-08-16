<script lang="ts">
	// A history card's header cluster: the live reading, and — for someone who
	// may save one — the menu that puts this metric on a custom chart.
	//
	// Its own file because the card's template crossed the complexity gate once
	// the menu joined the readout in the section's `actions` snippet.
	import MetricReadout from './metric-readout.svelte';
	import MetricChartMenu from './metric-chart-menu.svelte';
	import { useAppSession } from '$lib/session';

	let {
		metricKey,
		value,
		unit
	}: { metricKey: string; value: number | undefined; unit: string } = $props();

	// Saving a custom chart is an admin write, so a viewer is not offered a menu
	// that would fail at the API.
	const session = useAppSession();
	const canEditCharts = $derived($session.data?.user.role === 'admin');
</script>

<!-- The live value was the right half of the card's own header row; it is the
     section's header cluster now. -->
<MetricReadout {value} {unit} />
{#if canEditCharts}
	<MetricChartMenu {metricKey} />
{/if}
