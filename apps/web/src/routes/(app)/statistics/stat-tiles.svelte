<script lang="ts" generics="Data">
	import { fade } from 'svelte/transition';
	import type { CostFormatters } from '$lib/cost/format';
	import { deriveTiles, type TileDef } from '$lib/statistics/tiles';
	import { getCustomizeSession } from '$lib/statistics/customize.svelte';
	import StatTile from './stat-tile.svelte';

	// Registry-driven headline tiles: resolves a TileDef registry against the
	// section's payload, so every statistics section shares one grid.
	let {
		defs,
		data,
		previous = null,
		formatters
	}: {
		defs: readonly TileDef<Data>[];
		data: Data;
		/** Same shape over a reference window — gives every tile a delta chip. */
		previous?: Data | null;
		formatters: CostFormatters;
	} = $props();

	const customize = getCustomizeSession();

	// deriveTiles already drops tiles this system has no data for (capability
	// gating); preference hiding applies on top — and is suspended while
	// customizing, so a hidden tile stays visible (dimmed) and toggleable.
	const tiles = $derived(deriveTiles(defs, data, formatters, previous ?? undefined));
	const shown = $derived(
		customize.active ? tiles : tiles.filter((t) => !customize.tileHidden(t.id))
	);
</script>

{#if shown.length > 0}
	<div
		class="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4"
		transition:fade={{ duration: 200 }}
	>
		{#each shown as tile (tile.id)}
			<StatTile {tile} />
		{/each}
	</div>
{/if}
