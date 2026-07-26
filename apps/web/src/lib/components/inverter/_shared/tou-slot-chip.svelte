<script lang="ts">
	// One slot in the picker row beneath the timeline. Every slot gets a chip so it
	// stays reachable even when its timeline block is thin or collapsed to zero width
	// by a duplicate start time.
	import * as msg from '$lib/paraglide/messages';

	let {
		index,
		time,
		grid,
		selected,
		active,
		onSelect
	}: {
		index: number;
		/** Formatted start time. */
		time: string;
		/** Grid charging is enabled for this slot. */
		grid: boolean;
		selected: boolean;
		/** This slot's period contains "now". */
		active: boolean;
		onSelect: () => void;
	} = $props();

	const chipClass = $derived(
		selected ? 'border-primary bg-primary/10 font-medium' : 'border-border hover:bg-muted'
	);
	const dotClass = $derived(grid ? 'bg-amber-500' : 'bg-sky-500');
</script>

<button
	type="button"
	onclick={onSelect}
	class="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors {chipClass}"
>
	<span class="size-2 rounded-full {dotClass}"></span>
	<span>{msg.tou_slot_n({ index })}</span>
	<span class="tabular-nums text-muted-foreground">{time}</span>
	{#if active}
		<span class="text-[10px] font-medium text-primary">{msg.tou_now_short()}</span>
	{/if}
</button>
