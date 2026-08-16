<script lang="ts">
	import Section from '$lib/components/layout/section.svelte';
	import EntityHistoryCard from '$lib/components/inverter/entity-history-card.svelte';
	import type { ManifestMetric } from '$lib/inverter/types';
	import type { HistoryRange } from '$lib/inverter/ranges';

	// One catalogue category on /history. It used to draw a bottom-ruled,
	// sentence-case header with its own caret and no reduced-motion handling —
	// a different card from the one /statistics shows one nav entry above, for
	// the same structural role. It is the shared section card now.
	let {
		category,
		metrics,
		range,
		open,
		onOpenChange,
		onZoom,
		onResetZoom
	}: {
		category: string;
		metrics: ManifestMetric[];
		range: HistoryRange;
		open: boolean;
		onOpenChange: (open: boolean) => void;
		/** Forwarded from every card: a zoom on one chart moves the whole page. */
		onZoom?: (next: HistoryRange) => void;
		onResetZoom?: () => void;
	} = $props();

	const accentFor = (i: number) => `var(--color-chart-${(i % 5) + 1})`;
</script>

<!-- `controlled`: the page keeps one collapsed-by-category record and recomputes
     `open` from it, so the card must not also write the prop. -->
<Section title={category} collapsible controlled {open} {onOpenChange}>
	{#snippet actions()}
		<span class="text-xs text-muted-foreground">({metrics.length})</span>
	{/snippet}
	<div class="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
		{#each metrics as metric, i (metric.key)}
			<EntityHistoryCard {metric} {range} accent={accentFor(i)} {onZoom} {onResetZoom} />
		{/each}
	</div>
</Section>
