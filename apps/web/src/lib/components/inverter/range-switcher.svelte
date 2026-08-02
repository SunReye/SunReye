<script lang="ts" generics="T extends string">
	import { Button } from '$lib/components/ui/button';

	// Segmented button group for picking a named range (history window, cost
	// period, …). Generic over the option id so `bind:value` stays type-safe.
	let {
		options,
		value = $bindable()
	}: {
		options: readonly { id: T; label: string }[];
		value: T;
	} = $props();
</script>

<div class="flex flex-wrap items-center gap-1 border border-border p-1">
	{#each options as o (o.id)}
		<Button
			variant={value === o.id ? 'default' : 'ghost'}
			size="sm"
			onclick={() => (value = o.id)}
		>
			{o.label}
		</Button>
	{/each}
</div>
