<script lang="ts" module>
	/** One entry of a row's overflow menu. */
	export type OverflowItem = {
		id: string;
		label: string;
		onSelect: () => void;
		/** Painted as the destructive action. */
		destructive?: boolean;
		disabled?: boolean;
		/** Why a disabled entry is refused — rendered under it, not in a tooltip a phone cannot hover. */
		hint?: string;
	};
</script>

<script lang="ts">
	import DotsThreeVertical from 'phosphor-svelte/lib/DotsThreeVertical';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import RowOverflowItem from './row-overflow-item.svelte';

	// The secondary controls of a roster row, behind one "⋯" button. A row shows
	// its identity and ONE primary control; everything else — the rare and the
	// destructive — lives here, so a phone row stays a single line.
	let {
		label,
		items,
		disabled = false
	}: {
		/** The trigger's accessible name — "More actions for Meter". */
		label: string;
		items: readonly OverflowItem[];
		disabled?: boolean;
	} = $props();
</script>

{#if items.length > 0}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger {disabled}>
			{#snippet child({ props })}
				<Button
					variant="ghost"
					size="icon"
					class="size-9 shrink-0 sm:size-8"
					aria-label={label}
					data-row-menu
					{...props}
				>
					<DotsThreeVertical class="size-4" weight="bold" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-60 max-w-[calc(100vw-2rem)]">
			{#each items as item (item.id)}
				<RowOverflowItem {item} />
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/if}
