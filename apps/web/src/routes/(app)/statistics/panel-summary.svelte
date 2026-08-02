<script lang="ts" module>
	/** The window's headline figure beside a chart title, with its change against
	 *  the reference window. */
	export type PanelSummary = {
		value: string;
		delta: number | null;
		goodDirection: 'up' | 'down' | 'neutral';
		/** What the delta compares against, in words. */
		baseline: string;
	};
</script>

<script lang="ts">
	import DeltaChip from '$lib/components/statistics/delta-chip.svelte';

	let { summary }: { summary: PanelSummary } = $props();
</script>

<span class="flex items-baseline gap-2">
	<span class="text-sm font-semibold tabular-nums">{summary.value}</span>
	<DeltaChip
		delta={summary.delta}
		goodDirection={summary.goodDirection}
		baseline={summary.baseline}
	/>
</span>
