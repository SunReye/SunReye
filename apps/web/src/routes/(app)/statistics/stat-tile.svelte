<script lang="ts">
	import Info from 'phosphor-svelte/lib/Info';
	import * as Popover from '$lib/components/ui/popover';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as m from '$lib/paraglide/messages';
	import type { Tile } from '$lib/statistics/tiles';
	import DeltaChip from '$lib/components/statistics/delta-chip.svelte';
	import { getCustomizeSession } from '$lib/statistics/customize.svelte';
	import { TAP } from '$lib/layout/tokens';

	// One resolved tile: figure, sub-line, explanation popover — plus the
	// visibility checkbox while the page is being customized.
	let { tile, baseline }: { tile: Tile; baseline?: string } = $props();

	const customize = getCustomizeSession();
	const hidden = $derived(customize.tileHidden(tile.id));
	// Hidden tiles only ever render while customizing (the grid filters them
	// out otherwise), where they preview at 40%.
	const cardClass = $derived(
		`flex flex-col gap-1 border-b border-r border-border bg-background px-4 py-3 ${hidden ? 'opacity-40' : ''}`
	);
</script>

<div class={cardClass}>
	<div class="flex items-center gap-1.5">
		{#if customize.active}
			<Checkbox
				checked={!hidden}
				onCheckedChange={() => customize.toggleTile(tile.id)}
				aria-label={m.statistics_customize_tile_aria({ label: tile.label })}
			/>
		{/if}
		<!-- 0.65rem is 10.4px: under the 12px floor, uppercase and letter-spaced,
		     and it carries the tile's only identification. Full size on a phone. -->
		<span
			class="text-xs sm:text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground"
		>
			{tile.label}
		</span>
		<Popover.Root>
			<Popover.Trigger
				class="{TAP} text-muted-foreground/70 transition-colors hover:text-foreground"
				aria-label={m.costs_tile_info_aria({ label: tile.label })}
			>
				<Info class="size-3.5" weight="bold" />
			</Popover.Trigger>
			<Popover.Content class="max-w-xs text-xs leading-relaxed">
				{tile.explain}
			</Popover.Content>
		</Popover.Root>
	</div>
	<div class="flex items-baseline gap-2">
		<span class="text-2xl font-semibold tabular-nums {tile.accent}">{tile.value}</span>
		{#if tile.delta !== undefined}
			<DeltaChip delta={tile.delta} goodDirection={tile.goodDirection} {baseline} />
		{/if}
	</div>
	<span class="text-xs text-muted-foreground">{tile.sub}</span>
</div>
