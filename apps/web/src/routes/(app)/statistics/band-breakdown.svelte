<script lang="ts">
	import { fade } from 'svelte/transition';
	import Section from '$lib/components/layout/section.svelte';

	// Import split across the tariff's price bands. Rows arrive pre-formatted and
	// the section hides itself when the tariff has no bands to report.
	//
	// `nested` for the same reason the chart panels are: this renders inside a
	// statistics section, and a phone cannot afford the second frame.
	let {
		title,
		rows
	}: {
		title: string;
		rows: { name: string; energy: string; cost: string }[];
	} = $props();
</script>

{#if rows.length > 0}
	<!-- The fade needs an element this file owns; the card's root is a component. -->
	<div transition:fade={{ duration: 200 }}>
		<Section {title} nested>
			<!-- Three columns on one 412px row left the band name ~120px, which
			     truncated every German tariff label. Below sm the name takes its own
			     line and the two figures share the next one — two lines a band, but
			     both of them readable. -->
			<div class="flex flex-col gap-1.5 text-sm">
				{#each rows as b (b.name)}
					<div class="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
						<span class="min-w-0">{b.name}</span>
						<span class="flex justify-between gap-3 tabular-nums sm:justify-end">
							<span class="text-muted-foreground">{b.energy}</span>
							<span class="w-20 text-right">{b.cost}</span>
						</span>
					</div>
				{/each}
			</div>
		</Section>
	</div>
{/if}
