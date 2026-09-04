<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as m from '$lib/paraglide/messages';
	import { apiErrorText } from '../api-error';
	import ConnectionDeleteDialog from './connection-delete-dialog.svelte';
	import ConnectionTest from './connection-test.svelte';
	import type { ConnectionView, DeviceView, NewConnection, Transport } from './device-types';
	import NewConnectionFields from './new-connection-fields.svelte';

	// Edit one gateway. Every device bound to it follows the save — the
	// description says so. Delete is offered only when nothing is bound, which is
	// also the only case the server (and the FK under it) will accept.
	let {
		connection = $bindable(null),
		devices,
		onSaved,
		onDeleted
	}: {
		/** The gateway being edited; null closes the dialog. */
		connection?: ConnectionView | null;
		/** The devices on it, for the probe's unit id and the delete guard. */
		devices: DeviceView[];
		onSaved: () => void;
		onDeleted: () => void;
	} = $props();

	let draft = $state<NewConnection>(blank());
	let busy = $state(false);
	let confirmDelete = $state(false);

	const open = $derived(connection !== null);
	const name = $derived(connection?.name ?? '');
	const canDelete = $derived(devices.length === 0);
	const sendable = $derived(draft.host.trim() !== '' && !busy);

	function blank(): NewConnection {
		return { name: '', host: '', port: 502, transport: 'tcp', timeoutMs: 2000, pollIntervalMs: 1000 };
	}

	// A fresh draft each time a gateway is opened.
	$effect(() => {
		if (connection) {
			draft = { ...connection, transport: connection.transport as Transport };
			confirmDelete = false;
		}
	});

	function close() {
		connection = null;
	}

	/** The failure toast for either write, from the treaty's error shape. */
	function failed(template: (args: { error: string }) => string, error: { value: unknown } | null) {
		toast.error(template({ error: apiErrorText(error?.value, m.error_unknown()) }));
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		const target = connection;
		if (!target || !sendable) return;
		busy = true;
		const result = await api.api.connections({ id: String(target.id) }).patch({ ...draft, host: draft.host.trim() });
		busy = false;
		if (!result.data) return failed(m.devices_toast_connection_failed, result.error);
		toast.success(m.devices_toast_connection_saved({ name: (result.data as ConnectionView).name }));
		onSaved();
		close();
	}

	async function remove() {
		const target = connection;
		if (!target) return;
		busy = true;
		const result = await api.api.connections({ id: String(target.id) }).delete();
		busy = false;
		if (!result.data) return failed(m.devices_toast_connection_delete_failed, result.error);
		toast.success(m.devices_toast_connection_deleted({ name: target.name }));
		onDeleted();
		close();
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => !v && close()}>
	<Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>{m.devices_connection_dialog_title()}</Dialog.Title>
			<Dialog.Description>{m.devices_connection_dialog_description()}</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-4" onsubmit={save}>
			<NewConnectionFields bind:connection={draft} />
			<ConnectionTest {draft} device={devices[0] ?? null} />
			<Dialog.Footer class="sm:justify-between">
				<div>
					{#if canDelete}
						<Button type="button" variant="destructive" disabled={busy} onclick={() => (confirmDelete = true)}>
							{m.action_delete()}
						</Button>
					{/if}
				</div>
				<div class="flex gap-2">
					<Button type="button" variant="outline" onclick={close}>{m.action_cancel()}</Button>
					<Button type="submit" disabled={!sendable}>{m.action_save()}</Button>
				</div>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<ConnectionDeleteDialog bind:open={confirmDelete} {name} {busy} onConfirm={remove} />
