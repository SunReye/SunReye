<script lang="ts">
	import { fade } from 'svelte/transition';
	import Info from 'phosphor-svelte/lib/Info';
	import * as Popover from '$lib/components/ui/popover';
	import * as m from '$lib/paraglide/messages';

	// Headline figures for the costs page. Every string arrives pre-formatted so
	// currency and locale handling stays with the page that owns the tariff.
	let {
		tiles
	}: {
		tiles: {
			id: string;
			label: string;
			value: string;
			sub: string;
			/** Tailwind text-* class emphasising a figure in the household's favour. */
			accent: string;
			explain: string;
		}[];
	} = $props();
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
