<script lang="ts">
	/** Read-only label/value grid used by the automation status panels. */
	export type MetricRow = { label: string; value: string };

	let { rows }: { rows: MetricRow[] } = $props();
</script>

<dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
	{#each rows as row (row.label)}
		<div>
			<dt class="text-muted-foreground">{row.label}</dt>
			<dd class="font-medium">{row.value}</dd>
		</div>
	{/each}
</dl>
