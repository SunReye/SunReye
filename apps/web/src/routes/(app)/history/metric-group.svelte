<script lang="ts">
	import CaretDown from 'phosphor-svelte/lib/CaretDown';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import EntityHistoryCard from '$lib/components/inverter/entity-history-card.svelte';
	import type { ManifestMetric } from '$lib/inverter/types';
	import type { HistoryRange } from '$lib/inverter/ranges';

	let {
		category,
		metrics,
		range,
		open,
		onOpenChange
	}: {
		category: string;
		metrics: ManifestMetric[];
		range: HistoryRange;
		open: boolean;
		onOpenChange: (open: boolean) => void;
	} = $props();

	const accentFor = (i: number) => `var(--color-chart-${(i % 5) + 1})`;
</script>

<Collapsible.Root {open} {onOpenChange}>
	<Collapsible.Trigger
		class="group flex w-full items-center gap-2 border-b border-border py-2 text-left text-sm font-medium"
	>
		<CaretDown
			class="size-4 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90"
		/>
		{category}
		<span class="text-xs text-muted-foreground">({metrics.length})</span>
	</Collapsible.Trigger>
	<Collapsible.Content>
		<div class="grid gap-4 pt-4 lg:grid-cols-2 xl:grid-cols-3">
			{#each metrics as metric, i (metric.key)}
				<EntityHistoryCard {metric} {range} accent={accentFor(i)} />
			{/each}
		</div>
	</Collapsible.Content>
</Collapsible.Root>
