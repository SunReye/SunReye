<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as m from '$lib/paraglide/messages';
	import { apiErrorText } from '../api-error';
	import ConnectionDeleteDialog from './connection-delete-dialog.svelte';
	import DialogShell from './device-dialog-shell.svelte';
	import ConnectionProbe from './connection-probe.svelte';
	import {
		type ConnectionDraft,
		blankDraft,
		connectionCreateBody,
		connectionPatchBody,
		draftFromConnection
	} from './connection-draft';
	import type { ConnectionView, DeviceView } from './device-types';
	import NewConnectionFields from './new-connection-fields.svelte';

	// Add or edit ONE endpoint: a Modbus gateway, or an MQTT broker (#217). Every
	// device bound to a gateway follows the save — the description says so.
	//
	// A broker is created here and nowhere else. `POST /api/devices` can create a
	// connection alongside a device, but a broker has no device to be created
	// with: the EVCC loadpoints appear after the ingest is bound to it.
	//
	// Delete is offered only when nothing is bound, which is also the only case
	// the server (and the FK under it) accepts.
	let {
		target = $bindable(null),
		devices,
		onSaved,
		onDeleted
	}: {
		/** The connection being edited, `'new'` to add one, or null to close. */
		target?: ConnectionView | 'new' | null;
		/** The devices on it — the delete guard. */
		devices: DeviceView[];
		onSaved: () => void;
		onDeleted: () => void;
	} = $props();

	let draft = $state<ConnectionDraft>(blankDraft());
	let busy = $state(false);
	let confirmDelete = $state(false);

	const open = $derived(target !== null);
	const existing = $derived(target !== null && target !== 'new' ? target : null);
	const editing = $derived(existing !== null);
	const name = $derived(existing?.name ?? '');
	const canDelete = $derived(editing && devices.length === 0);
	const body = $derived(editing ? connectionPatchBody(draft) : connectionCreateBody(draft));
	const sendable = $derived(body !== null && !busy);
	const title = $derived(
		editing ? m.devices_connection_dialog_title() : m.devices_connection_new_title()
	);
	const description = $derived(
		editing ? m.devices_connection_dialog_description() : m.devices_connection_new_description()
	);

	// A fresh draft each time the dialog opens: the previous endpoint's values
	// are the wrong defaults for the next one.
	$effect(() => {
		if (target === null) return;
		// A new endpoint starts NAMELESS: "Gateway 3" is a wrong name for a broker,
		// and the save button is disabled until the operator types one.
		draft = target === 'new' ? blankDraft() : draftFromConnection(target);
		confirmDelete = false;
	});

	function close() {
		target = null;
	}

	/** The failure toast for either write, from the treaty's error shape. */
	function failed(template: (args: { error: string }) => string, error: { value: unknown } | null) {
		toast.error(template({ error: apiErrorText(error?.value, m.error_unknown()) }));
	}

	/** The one write, addressed at the row when there is one. */
	function write(sending: NonNullable<typeof body>, row: ConnectionView | null) {
		if (row) return api.api.connections({ id: String(row.id) }).patch(sending);
		return api.api.connections.post(sending);
	}

	function announce(name: string, row: ConnectionView | null) {
		if (row) return toast.success(m.devices_toast_connection_saved({ name }));
		toast.success(m.devices_toast_connection_added({ name }));
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		const sending = body;
		if (!sendable || !sending) return;
		const row = existing;
		busy = true;
		const result = await write(sending, row);
		busy = false;
		if (!result.data) return failed(m.devices_toast_connection_failed, result.error);
		announce((result.data as ConnectionView).name, row);
		onSaved();
		close();
	}

	async function remove() {
		const row = existing;
		if (!row) return;
		busy = true;
		const result = await api.api.connections({ id: String(row.id) }).delete();
		busy = false;
		if (!result.data) return failed(m.devices_toast_connection_delete_failed, result.error);
		toast.success(m.devices_toast_connection_deleted({ name: row.name }));
		onDeleted();
		close();
	}
</script>

<DialogShell {open} {title} {description} onClose={close} onsubmit={save}>
	<NewConnectionFields bind:connection={draft} kind={editing ? 'locked' : 'choose'} />
	<ConnectionProbe {draft} />
	<Dialog.Footer class="sm:justify-between">
		<div>
			{#if canDelete}
				<Button
					type="button"
					variant="destructive"
					disabled={busy}
					onclick={() => (confirmDelete = true)}
				>
					{m.action_delete()}
				</Button>
			{/if}
		</div>
		<div class="flex gap-2">
			<Button type="button" variant="outline" onclick={close}>{m.action_cancel()}</Button>
			<Button type="submit" disabled={!sendable}>{m.action_save()}</Button>
		</div>
	</Dialog.Footer>
</DialogShell>

<ConnectionDeleteDialog bind:open={confirmDelete} {name} {busy} onConfirm={remove} />
