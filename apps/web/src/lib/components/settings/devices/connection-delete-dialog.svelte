<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as m from '$lib/paraglide/messages';

	// The confirmation before a gateway row is deleted. Only ever offered for a
	// gateway with no devices, so the body can say that plainly.
	let {
		open = $bindable(false),
		name,
		busy,
		onConfirm
	}: { open?: boolean; name: string; busy: boolean; onConfirm: () => void } = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.devices_connection_delete_title({ name })}</Dialog.Title>
			<Dialog.Description>{m.devices_connection_delete_body()}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>{m.action_cancel()}</Button>
			<Button variant="destructive" disabled={busy} onclick={onConfirm}>{m.action_delete()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
