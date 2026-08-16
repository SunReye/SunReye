<script lang="ts">
	/** Read-only label/value grid used by the automation status panels. */
	export type MetricRow = { label: string; value: string };

	let { rows }: { rows: MetricRow[] } = $props();
</script>

<!-- The column gutter steps down on a phone: 24px between two 412px columns is
     6% of the screen spent on nothing, and the German labels need it. -->
<dl class="grid grid-cols-2 gap-x-3 sm:gap-x-6 gap-y-3 text-sm sm:grid-cols-3 [&>*]:min-w-0">
	{#each rows as row (row.label)}
		<div>
			<dt class="text-muted-foreground">{row.label}</dt>
			<dd class="font-medium tabular-nums">{row.value}</dd>
		</div>
	{/each}
</dl>
