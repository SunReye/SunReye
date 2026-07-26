<script lang="ts">
	// Category-grouped, checkbox metric picker used by the custom-chart editor.
	// Selection lives with the caller (a SvelteSet it mutates), so this only renders
	// the grouped list and reports toggles.
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as m from '$lib/paraglide/messages';
	import type { ManifestMetric } from '$lib/inverter/types';

	let {
		groups,
		isSelected,
		atLimit,
		onToggle,
		emptyQuery
	}: {
		/** `[category, metrics]` pairs, already filtered by the search box. */
		groups: [string, ManifestMetric[]][];
		isSelected: (key: string) => boolean;
		/** No more metrics may be added; unselected rows go disabled. */
		atLimit: boolean;
		onToggle: (key: string) => void;
		/** The current search text, for the no-matches message. */
		emptyQuery: string;
	} = $props();

	/** At the cap, only already-selected rows stay actionable (so they can be removed). */
	const rowDisabled = (key: string) => !isSelected(key) && atLimit;
</script>

<div class="flex flex-col p-1">
	{#each groups as [category, metrics] (category)}
		<div
			class="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
		>
			{category}
		</div>
		{#each metrics as metric (metric.key)}
			{@const checked = isSelected(metric.key)}
			<label
				class="flex cursor-pointer items-center gap-2 rounded-xs px-2 py-1.5 text-sm hover:bg-muted/50 has-disabled:cursor-not-allowed has-disabled:opacity-50"
			>
				<Checkbox
					{checked}
					disabled={rowDisabled(metric.key)}
					onCheckedChange={() => onToggle(metric.key)}
				/>
				<span class="truncate">{metric.label}</span>
				{#if metric.unit}
					<span class="ml-auto shrink-0 text-xs text-muted-foreground">{metric.unit}</span>
				{/if}
			</label>
		{/each}
	{:else}
		<div class="px-2 py-6 text-center text-sm text-muted-foreground">
			{m.chart_no_metrics_match({ query: emptyQuery })}
		</div>
	{/each}
</div>
