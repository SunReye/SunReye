<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';
	import type { DeviceView } from './device-types';

	// A retired device offers Restore; one in service offers Rename and Retire.
	// The polled device cannot be retired from here — that would silence the
	// plant, and WHICH device is polled is the inverter form's decision.
	let {
		device,
		busy,
		onRename,
		onRetire,
		onRestore
	}: {
		device: DeviceView;
		busy: boolean;
		onRename: () => void;
		onRetire: (device: DeviceView) => void;
		onRestore: (device: DeviceView) => void;
	} = $props();

	const retireBlocked = $derived(busy || device.polled);
</script>

<div class="flex shrink-0 items-center gap-2">
	{#if device.retiredAt !== null}
		<Button variant="outline" size="sm" class="flex-1 sm:flex-none" disabled={busy} onclick={() => onRestore(device)}>
			{m.devices_action_restore()}
		</Button>
	{:else}
		<Button variant="outline" size="sm" class="flex-1 sm:flex-none" disabled={busy} onclick={onRename}>
			{m.devices_action_rename()}
		</Button>
		<Button
			variant="ghost"
			size="sm"
			class="flex-1 sm:flex-none"
			disabled={retireBlocked}
			title={device.polled ? m.devices_not_polled_hint() : undefined}
			onclick={() => onRetire(device)}
		>
			{m.devices_action_retire()}
		</Button>
	{/if}
</div>
