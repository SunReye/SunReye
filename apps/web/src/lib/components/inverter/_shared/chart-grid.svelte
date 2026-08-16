<script lang="ts">
	// The saved custom charts, two per row from lg up.
	import CustomChartCard from '$lib/components/inverter/custom-chart-card.svelte';
	import type { CustomChart } from '$lib/inverter/custom-chart';
	import type { HistoryRange } from '$lib/inverter/ranges';

	let {
		charts,
		range,
		isAdmin,
		onEdit,
		onDelete
	}: {
		charts: CustomChart[];
		range: HistoryRange;
		isAdmin: boolean;
		onEdit: (chart: CustomChart) => void;
		onDelete: (chart: CustomChart) => void;
	} = $props();
</script>

<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
	{#each charts as chart (chart.id)}
		<CustomChartCard
			{chart}
			{range}
			{isAdmin}
			onEdit={() => onEdit(chart)}
			onDelete={() => onDelete(chart)}
		/>
	{/each}
</div>
