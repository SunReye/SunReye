<script lang="ts" generics="Data">
	import { fade } from 'svelte/transition';
	import type { CostFormatters } from '$lib/cost/format';
	import { deriveTiles, type TileDef } from '$lib/statistics/tiles';
	import { getCustomizeSession } from '$lib/statistics/customize.svelte';
	import StatTile from './stat-tile.svelte';
	import { TILE_COLUMNS } from '$lib/layout/tokens';

	// Registry-driven headline tiles: resolves a TileDef registry against the
	// section's payload, so every statistics section shares one grid.
	let {
		defs,
		data,
		previous = null,
		baseline,
		formatters
	}: {
		defs: readonly TileDef<Data>[];
		data: Data;
		/** Same shape over a reference window — gives every tile a delta chip. */
		previous?: Data | null;
		/** What those chips compare against, in words ("yesterday"). */
		baseline?: string;
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

<!-- Separators are per-tile borders rather than gaps over a border-coloured
     backdrop: with a tile count that is not a multiple of the column count, the
     backdrop showed through the empty cells as grey slabs. That is also why
     this cannot spend GRID.tiles wholesale — it carries a gap — so it takes the
     column ramp alone and the tokens keep owning the decision. -->
{#if shown.length > 0}
	<div
		class="grid {TILE_COLUMNS} border-l border-t border-border [&>*]:min-w-0"
		transition:fade={{ duration: 200 }}
	>
		{#each shown as tile (tile.id)}
			<StatTile {tile} {baseline} />
		{/each}
	</div>
{/if}
