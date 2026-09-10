<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';
	import { resolve } from '$lib/resolve';
	import type { DeviceView } from './device-types';
	import ModbusActions from './modbus-actions.svelte';

	// Only a MODBUS device offers the roster's controls. The edit dialog changes
	// a gateway, a unit id and a profile, none of which a coded or a virtual
	// device has: it opened seeded on the plant's FIRST gateway, so saving an
	// untouched edit bound the loadpoint or the optimizer to that gateway (#213
	// — the server answers 409 for one now). A coded device is configured where
	// its feed is instead; EVCC's settings live on the MQTT tab until #217.
	let {
		device,
		busy,
		onEdit,
		onRetire,
		onRestore
	}: {
		device: DeviceView;
		busy: boolean;
		onEdit: (device: DeviceView) => void;
		onRetire: (device: DeviceView) => void;
		onRestore: (device: DeviceView) => void;
	} = $props();

	const configurable = $derived(device.kind === 'coded' && device.integration === 'evcc');
</script>

<div class="flex shrink-0 flex-wrap items-center gap-2">
	{#if device.kind === 'modbus'}
		<ModbusActions {device} {busy} {onEdit} {onRetire} {onRestore} />
	{:else if configurable}
		<Button variant="outline" size="sm" class="flex-1 sm:flex-none" href={resolve('/settings/mqtt')}>
			{m.devices_action_configure()}
		</Button>
	{/if}
</div>
