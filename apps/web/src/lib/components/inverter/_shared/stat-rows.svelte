<script lang="ts">
	// A gapless stack of metric rows — the rows rule themselves, so the stack owns
	// no spacing of its own. Both places a node's dialog lists readings use it.
	import { inverter } from '$lib/inverter/store.svelte';
	import type { ManifestMetric } from '$lib/inverter/types';
	import StatRow from '../stat-row.svelte';

	let { metrics }: { metrics: ManifestMetric[] } = $props();
</script>

<div class="flex flex-col">
	{#each metrics as metric (metric.key)}
		<StatRow {metric} value={inverter.value(metric.key)} />
	{/each}
</div>
