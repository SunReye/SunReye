<script lang="ts" generics="Data">
	import { fade } from 'svelte/transition';
	import Info from 'phosphor-svelte/lib/Info';
	import * as Popover from '$lib/components/ui/popover';
	import * as m from '$lib/paraglide/messages';
	import type { CostFormatters } from '$lib/cost/format';
	import { deriveTiles, type TileDef } from '$lib/statistics/tiles';

	// Registry-driven headline tiles: resolves a TileDef registry against the
	// section's payload, so every statistics section shares one grid. Markup is
	// the costs page's tile grid, unchanged.
	let {
		defs,
		data,
		formatters
	}: {
		defs: readonly TileDef<Data>[];
		data: Data;
		formatters: CostFormatters;
	} = $props();

	const tiles = $derived(deriveTiles(defs, data, formatters));
</script>

<div
	class="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4"
	transition:fade={{ duration: 200 }}
>
	{#each tiles as t (t.id)}
		<div class="flex flex-col gap-1 bg-background px-4 py-3">
			<div class="flex items-center gap-1.5">
				<span class="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
					{t.label}
				</span>
				<Popover.Root>
					<Popover.Trigger
						class="text-muted-foreground/70 transition-colors hover:text-foreground"
						aria-label={m.costs_tile_info_aria({ label: t.label })}
					>
						<Info class="size-3.5" weight="bold" />
					</Popover.Trigger>
					<Popover.Content class="max-w-xs text-xs leading-relaxed">
						{t.explain}
					</Popover.Content>
				</Popover.Root>
			</div>
			<span class="text-2xl font-semibold tabular-nums {t.accent}">{t.value}</span>
			<span class="text-xs text-muted-foreground">{t.sub}</span>
		</div>
	{/each}
</div>
