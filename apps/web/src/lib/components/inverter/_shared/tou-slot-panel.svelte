<script lang="ts">
	// The editor for the currently selected TOU slot. Keyed on the slot index so the
	// editor is rebuilt — and its uncommitted SOC drag dropped — whenever the
	// selection moves to another slot. Renders nothing when no slot is selectable.
	import TouSlotEditor from '$lib/components/inverter/tou-slot-editor.svelte';
	import type { TouController, TouSlot } from '$lib/inverter/tou.svelte';

	let {
		controller,
		slot,
		range,
		slotCount
	}: {
		controller: TouController;
		slot: TouSlot | null;
		/** The slot's "start → end" caption, or null while either time is unread. */
		range: string | null;
		slotCount: number;
	} = $props();
</script>

{#if slot}
	{#key slot.index}
		<TouSlotEditor {controller} {slot} {range} {slotCount} />
	{/key}
{/if}
