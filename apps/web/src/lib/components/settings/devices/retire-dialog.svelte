<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as m from '$lib/paraglide/messages';
	import type { DeviceView } from './device-types';

	// The confirmation before a device leaves service. Open while `device` is
	// set; the parent clears it on cancel and acts on confirm.
	let {
		device,
		onCancel,
		onConfirm
	}: {
		device: DeviceView | null;
		onCancel: () => void;
		onConfirm: () => void;
	} = $props();

	const name = $derived(device?.name ?? '');
</script>

<Dialog.Root open={device !== null} onOpenChange={(v) => !v && onCancel()}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.devices_retire_title({ name })}</Dialog.Title>
			<Dialog.Description>{m.devices_retire_body()}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={onCancel}>{m.action_cancel()}</Button>
			<Button variant="destructive" onclick={onConfirm}>{m.devices_action_retire()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
