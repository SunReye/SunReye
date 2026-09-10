<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import Section from '$lib/components/layout/section.svelte';
	import * as m from '$lib/paraglide/messages';
	import { resolve } from '$lib/resolve';
	import { apiErrorText } from '../api-error';
	import { readCatalog, readIntegrations, refuseIntegration } from '../integrations/integration-io';
	import InverterStatusBadge from '../inverter-status-badge.svelte';
	import type { InverterStatus } from '../inverter-types';
	import type { Catalog } from '../wizard/add-wizard';
	import AddDeviceDialog from './add-device-dialog.svelte';
	import ConnectionDialog from './connection-dialog.svelte';
	import DeviceList from './device-list.svelte';
	import type {
		ConnectionView,
		DeviceRoster,
		DeviceView,
		IntegrationPatchBody,
		IntegrationView
	} from './device-types';
	import IntegrationEditDialog from './integration-edit-dialog.svelte';
	import IntegrationRemoveDialog from './integration-remove-dialog.svelte';
	import RenameDialog from './rename-dialog.svelte';
	import RetireDialog from './retire-dialog.svelte';

	// The devices panel: the plant's connections and, under each, both halves of
	// what hangs off it — the devices reached THROUGH it, retired ones included
	// (a device the UI cannot see is a device nobody can restore), and the
	// integrations that RUN over it. The header badge is the poll loop's health —
	// the one link this release drives.
	//
	// The integrations used to be a tab of their own (`/settings/mqtt`), which
	// meant the page that answered "what is on this broker" showed the loadpoints
	// and no sign of the EVCC ingest that provisioned them.
	let { status = null }: { status?: InverterStatus | null } = $props();

	let roster = $state<DeviceRoster | null>(null);
	let integrations = $state<IntegrationView[]>([]);
	/** What each integration kind's settings step asks for; the edit dialog renders it. */
	let catalog = $state<Catalog>({ modbus: [], mqtt: [], internal: [] });
	let loadFailed = $state(false);
	let busyId = $state<number | null>(null);
	let busyIntegrationId = $state<number | null>(null);
	let dialogOpen = $state(false);
	/** The device the dialog edits, or null when it adds. */
	let editing = $state<DeviceView | null>(null);
	/** The connection dialog's subject: a row to edit, `'new'` to add, null closed. */
	let connection = $state<ConnectionView | 'new' | null>(null);
	let retiring = $state<DeviceView | null>(null);
	/** The row the name-only dialog is open on, or null. A coded or virtual row
	    has no addressing to edit; #219 left `name` as the one thing it may set. */
	let renaming = $state<DeviceView | null>(null);
	let configuring = $state<IntegrationView | null>(null);
	let removing = $state<IntegrationView | null>(null);

	const editingConnection = $derived(
		connection !== null && connection !== 'new' ? connection : null
	);
	const onConnection = $derived(
		roster && editingConnection
			? roster.devices.filter((d) => d.connectionId === editingConnection.id)
			: []
	);
	/** The roster the list groups, with the integrations folded in. */
	const grouped = $derived(roster && { ...roster, integrations });

	async function load() {
		const { data, error } = await api.api.devices.get();
		loadFailed = Boolean(error);
		if (data) roster = data as DeviceRoster;
	}

	/** The integration rows, reloaded after every write. */
	async function loadIntegrations() {
		const rows = await readIntegrations();
		if (rows) integrations = rows;
	}

	onMount(async () => {
		const shelf = await readCatalog();
		if (shelf) catalog = shelf;
		await Promise.all([load(), loadIntegrations()]);
	});

	async function setRetired(device: DeviceView, retired: boolean) {
		busyId = device.id;
		const result = await api.api.devices({ id: String(device.id) }).patch({ retired });
		busyId = null;
		if (!result.data) {
			const error = apiErrorText(result.error?.value, m.error_unknown());
			toast.error(m.devices_toast_update_failed({ error }));
			return;
		}
		toast.success(m.devices_toast_updated({ name: (result.data as DeviceView).name }));
		await load();
	}

	function openDialog(device: DeviceView | null) {
		editing = device;
		dialogOpen = true;
	}

	async function confirmRetire() {
		const target = retiring;
		retiring = null;
		if (target) await setRetired(target, true);
	}

	/**
	 * Both integration writes are the same PATCH with a different body, and both
	 * end the same way: the row list reloaded, and the roster with it — removing
	 * an EVCC ingest retires its loadpoints, so the devices above change too.
	 */
	async function patch(row: IntegrationView, body: IntegrationPatchBody, success: string) {
		busyIntegrationId = row.id;
		const result = await api.api.integrations({ id: String(row.id) }).patch(body);
		busyIntegrationId = null;
		if (!result.data) return refuseIntegration(result.error?.value);
		toast.success(success);
		await Promise.all([load(), loadIntegrations()]);
	}

	const toggle = (row: IntegrationView, enabled: boolean) =>
		patch(row, { enabled }, m.devices_integration_toast_saved({ label: row.label }));

	const saveParams = (row: IntegrationView, params: Record<string, unknown>) =>
		patch(row, { params }, m.devices_integration_toast_saved({ label: row.label }));

	async function confirmRemove() {
		const row = removing;
		removing = null;
		if (!row) return;
		busyIntegrationId = row.id;
		const result = await api.api.integrations({ id: String(row.id) }).delete();
		busyIntegrationId = null;
		if (!result.data) return refuseIntegration(result.error?.value);
		toast.success(m.devices_integration_toast_removed({ label: row.label }));
		await Promise.all([load(), loadIntegrations()]);
	}
</script>

<Section title={m.devices_section_title()}>
	{#snippet actions()}
		<InverterStatusBadge {status} />
		<!-- A connection is added on its own, not only alongside a device: a broker
		     has no device to be created with — its loadpoints appear after the EVCC
		     ingest is bound to it (#217). -->
		<Button
			size="sm"
			variant="outline"
			class="h-9 sm:h-8"
			onclick={() => (connection = 'new')}
			disabled={!roster}
		>
			{m.devices_add_connection()}
		</Button>
		<!-- ONE "Add…", and it is the wizard (`/settings/devices/add`). The old
		     dialog added a Modbus device and nothing else — contractually, not by
		     oversight — so a broker's integrations had no entry point at all. It
		     stays mounted below for EDITING an existing row. -->
		<Button size="sm" class="h-9 sm:h-8" href={resolve('/settings/devices/add')} disabled={!roster}>
			{m.devices_add()}
		</Button>
	{/snippet}
	<DeviceList
		roster={grouped}
		{loadFailed}
		{busyId}
		{busyIntegrationId}
		onEditConnection={(c) => (connection = c)}
		onEdit={openDialog}
		onRename={(d) => (renaming = d)}
		onRetire={(d) => (retiring = d)}
		onRestore={(d) => setRetired(d, false)}
		onEditIntegration={(i) => (configuring = i)}
		onToggleIntegration={toggle}
		onRemoveIntegration={(i) => (removing = i)}
	/>
</Section>

{#if roster}
	<AddDeviceDialog
		bind:open={dialogOpen}
		device={editing}
		connections={roster.connections}
		devices={roster.devices}
		onSaved={load}
	/>
	<ConnectionDialog bind:target={connection} devices={onConnection} onSaved={load} onDeleted={load} />
{/if}

<RenameDialog bind:device={renaming} onSaved={load} />

<RetireDialog device={retiring} onCancel={() => (retiring = null)} onConfirm={confirmRetire} />

<IntegrationEditDialog bind:integration={configuring} {catalog} onSave={saveParams} />

<IntegrationRemoveDialog
	integration={removing}
	devices={roster?.devices ?? []}
	busy={busyIntegrationId !== null}
	onCancel={() => (removing = null)}
	onConfirm={confirmRemove}
/>
