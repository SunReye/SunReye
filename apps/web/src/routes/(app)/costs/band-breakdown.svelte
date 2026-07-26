<script lang="ts">
	import { fade } from 'svelte/transition';

	// Import split across the tariff's price bands. Rows arrive pre-formatted and
	// the section hides itself when the tariff has no bands to report.
	let {
		title,
		rows
	}: {
		title: string;
		rows: { name: string; energy: string; cost: string }[];
	} = $props();
</script>

{#if rows.length > 0}
	<section class="flex flex-col gap-3 border border-border p-4" transition:fade={{ duration: 200 }}>
		<h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
		<div class="flex flex-col gap-1.5 text-sm">
			{#each rows as b (b.name)}
				<div class="flex items-center justify-between gap-3 tabular-nums">
					<span>{b.name}</span>
					<span class="text-muted-foreground">{b.energy}</span>
					<span class="w-20 text-right">{b.cost}</span>
				</div>
			{/each}
		</div>
	</section>
{/if}
