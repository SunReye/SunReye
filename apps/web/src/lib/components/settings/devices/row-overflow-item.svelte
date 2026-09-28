<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import type { OverflowItem } from './row-overflow-menu.svelte';

	// One entry of a row's overflow menu: its label, and — when refused — the
	// reason under it, since a phone cannot hover for a tooltip.
	let { item }: { item: OverflowItem } = $props();

	const variant = $derived(item.destructive ? 'destructive' : 'default');
</script>

<DropdownMenu.Item
	{variant}
	disabled={item.disabled}
	onSelect={item.onSelect}
	class="min-h-9 flex-col items-start gap-0.5 sm:min-h-8"
	data-menu-item={item.id}
>
	<span>{item.label}</span>
	{#if item.hint}
		<span class="text-xs text-muted-foreground">{item.hint}</span>
	{/if}
</DropdownMenu.Item>
