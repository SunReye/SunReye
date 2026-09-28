<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import Section from '$lib/components/layout/section.svelte';
	import * as m from '$lib/paraglide/messages';
	import { resolve } from '$lib/resolve';
	import InverterStatusBadge from '../inverter-status-badge.svelte';
	import type { InverterStatus } from '../inverter-types';
	import AddDeviceDialog from './add-device-dialog.svelte';
	import ConnectionDialog from './connection-dialog.svelte';
	import DeviceList from './device-list.svelte';
	import DeviceDeleteDialog from './device-delete-dialog.svelte';
	import { type WriteOutcome, failureText } from './device-roster';
	import { deviceRoster } from './device-roster.svelte';
	import type {
		ConnectionView,
		DeviceHandlers,
		DeviceView,
		IntegrationHandlers,
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

	// Every read and write, and the re-read after each, is the roster's; this
	// file holds which dialog is open and says what happened.
	const roster = deviceRoster({ afterWrite: 'reload' });
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
	/** The row the delete dialog is open on, or null. */
	let deleting = $state<DeviceView | null>(null);
	let configuring = $state<IntegrationView | null>(null);
	let removing = $state<IntegrationView | null>(null);

	const editingConnection = $derived(
		connection !== null && connection !== 'new' ? connection : null
	);
	const onConnection = $derived(
		editingConnection ? roster.devices.filter((d) => d.connectionId === editingConnection.id) : []
	);
	const groups = $derived(roster.groups);

	onMount(() => roster.load());

	async function setRetired(device: DeviceView, retired: boolean) {
		busyId = device.id;
		const outcome = await (retired ? roster.retire(device.id) : roster.restore(device.id));
		busyId = null;
		if (outcome.kind !== 'ok') {
			toast.error(m.devices_toast_update_failed({ error: failureText(outcome) }));
			return;
		}
		toast.success(m.devices_toast_updated({ name: outcome.value.name }));
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

	/** An integration write's answer, in the operator's words. */
	function reportIntegration(outcome: WriteOutcome<unknown>, success: string) {
		if (outcome.kind === 'ok') return void toast.success(success);
		toast.error(m.devices_integration_toast_failed({ error: failureText(outcome) }));
	}

	/** Both integration writes are the same PATCH with a different body. */
	async function patch(row: IntegrationView, body: IntegrationPatchBody, success: string) {
		busyIntegrationId = row.id;
		const outcome = await roster.patchIntegration(row.id, body);
		busyIntegrationId = null;
		reportIntegration(outcome, success);
	}

	const toggle = (row: IntegrationView, enabled: boolean) =>
		patch(row, { enabled }, m.devices_integration_toast_saved({ label: row.label }));

	const saveParams = (row: IntegrationView, params: Record<string, unknown>) =>
		patch(row, { params }, m.devices_integration_toast_saved({ label: row.label }));

	const handlers: DeviceHandlers = {
		edit: openDialog,
		rename: (d) => (renaming = d),
		retire: (d) => (retiring = d),
		restore: (d) => setRetired(d, false),
		delete: (d) => (deleting = d)
	};

	const integrationHandlers: IntegrationHandlers = {
		edit: (i) => (configuring = i),
		toggle,
		remove: (i) => (removing = i)
	};

	async function confirmRemove() {
		const row = removing;
		removing = null;
		if (!row) return;
		busyIntegrationId = row.id;
		const outcome = await roster.removeIntegration(row.id);
		busyIntegrationId = null;
		reportIntegration(outcome, m.devices_integration_toast_removed({ label: row.label }));
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
			disabled={!roster.loaded}
		>
			{m.devices_add_connection()}
		</Button>
		<!-- ONE "Add…", and it is the wizard (`/settings/devices/add`). The old
		     dialog added a Modbus device and nothing else — contractually, not by
		     oversight — so a broker's integrations had no entry point at all. It
		     stays mounted below for EDITING an existing row. -->
		<Button size="sm" class="h-9 sm:h-8" href={resolve('/settings/devices/add')} disabled={!roster.loaded}>
			{m.devices_add()}
		</Button>
	{/snippet}
	<DeviceList
		{groups}
		loaded={roster.loaded}
		loadFailed={roster.loadFailed}
		{busyId}
		{busyIntegrationId}
		onEditConnection={(c) => (connection = c)}
		{handlers}
		{integrationHandlers}
	/>
</Section>

{#if roster.loaded}
	<AddDeviceDialog bind:open={dialogOpen} device={editing} {roster} />
	<ConnectionDialog bind:target={connection} devices={onConnection} {roster} />
{/if}

<RenameDialog bind:device={renaming} {roster} />

<DeviceDeleteDialog bind:device={deleting} {roster} onRetire={(d) => (retiring = d)} />

<RetireDialog device={retiring} onCancel={() => (retiring = null)} onConfirm={confirmRetire} />

<IntegrationEditDialog bind:integration={configuring} catalog={roster.catalog} onSave={saveParams} />

<IntegrationRemoveDialog
	integration={removing}
	devices={roster.devices}
	busy={busyIntegrationId !== null}
	onCancel={() => (removing = null)}
	onConfirm={confirmRemove}
/>
