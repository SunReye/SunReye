<script lang="ts">
	import Section from '$lib/components/layout/section.svelte';
	import { inverter } from '$lib/inverter/store.svelte';
	import type { ManifestMetric } from '$lib/inverter/types';
	import StatRow from './stat-row.svelte';

	// One subsystem's readouts on /system. Card, header and rhythm come from the
	// shared section now; what is left here is which metrics to read.
	let {
		title,
		metrics,
		children
	}: {
		title: string;
		metrics: ManifestMetric[];
		children?: import('svelte').Snippet;
	} = $props();
</script>

<Section {title}>
	{@render children?.()}
	{#if metrics.length > 0}
		<!-- The rows rule themselves, so the stack stays gapless. -->
		<div class="flex flex-col">
			{#each metrics as m (m.key)}
				<StatRow metric={m} value={inverter.value(m.key)} />
			{/each}
		</div>
	{/if}
</Section>
