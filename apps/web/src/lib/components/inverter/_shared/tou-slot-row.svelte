<script lang="ts">
	// One slot's row in the TOU table. Every cell renders only if the profile maps
	// that register, and the two target columns follow the battery mode — so the row
	// matches the header the table drew.
	import { Switch } from '$lib/components/ui/switch';
	import * as Table from '$lib/components/ui/table';
	import TouCell from './tou-cell.svelte';
	import type { TouController, TouSlot } from '$lib/inverter/tou.svelte';

	let {
		controller,
		slot,
		showVoltage,
		showSoc
	}: {
		controller: TouController;
		slot: TouSlot;
		showVoltage: boolean;
		showSoc: boolean;
	} = $props();

	const enabled = $derived(slot.metrics.enabled);
	const isOn = $derived(!!enabled && controller.value(enabled.key) === 1);
	const busy = $derived(!!enabled && controller.busy(enabled.key));

	const setEnabled = (checked: boolean) => {
		if (enabled) controller.write(enabled.key, checked ? 1 : 0, enabled.label);
	};
</script>

<Table.Row>
	<Table.Cell class="font-medium tabular-nums">{slot.index}</Table.Cell>
	<Table.Cell>
		{#if enabled}
			<Switch checked={isOn} onCheckedChange={setEnabled} disabled={busy} />
		{/if}
	</Table.Cell>
	<TouCell {controller} metric={slot.metrics.time} kind="time" />
	<TouCell {controller} metric={slot.metrics.power} kind="number" />
	{#if showVoltage}
		<TouCell {controller} metric={slot.metrics.voltage} kind="number" step="0.01" />
	{/if}
	{#if showSoc}
		<TouCell {controller} metric={slot.metrics.soc} kind="number" min="0" max="100" />
	{/if}
</Table.Row>
