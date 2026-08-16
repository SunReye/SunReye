<script lang="ts">
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { resolve } from '$lib/resolve';
	import { STATE_LABEL, STATE_VARIANT } from './run-state';
	import type { Pathname } from '$app/types';
	import type { PeakShavingRunState } from '$lib/automations';

	// One row of the automations index. Every automation gets the same shape —
	// name, what it does, its live run state — so the list stays uniform as more
	// automations land.
	let {
		href,
		title,
		description,
		state,
		note
	}: {
		href: Pathname;
		title: string;
		description: string;
		state: PeakShavingRunState;
		/** Extra line under the description, e.g. the configured mode. */
		note?: string;
	} = $props();
</script>

<a
	href={resolve(href)}
	class="block outline-none focus-visible:ring-2 focus-visible:ring-ring"
>
	<Card.Root
		class="transition-[border-color,background-color,translate] duration-200 hover:border-primary/40 hover:bg-muted/40 motion-safe:hover:-translate-y-0.5"
	>
		<!-- The header is a grid whose implicit column is `auto`, so it sizes to
		     the max-content of its widest row — the title, its badge and the whole
		     description on one line. At 412px that made a 458px track inside a
		     380px card and pushed the text off the screen; the title's own
		     `min-w-0 truncate` could do nothing about a track that was never
		     asked to fit. -->
		<Card.Header class="grid-cols-[minmax(0,1fr)]">
			<Card.Title class="flex items-center gap-2">
				<span class="min-w-0 flex-1 truncate">{title}</span>
				<Badge variant={STATE_VARIANT[state]}>{STATE_LABEL[state]()}</Badge>
				<CaretRightIcon class="size-4 shrink-0 text-muted-foreground" />
			</Card.Title>
			<Card.Description>
				{description}
				{#if note}
					<span class="mt-1 block text-xs">{note}</span>
				{/if}
			</Card.Description>
		</Card.Header>
	</Card.Root>
</a>
