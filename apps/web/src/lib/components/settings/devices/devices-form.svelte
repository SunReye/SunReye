<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import Section from '$lib/components/layout/section.svelte';
	import * as m from '$lib/paraglide/messages';
	import { apiErrorText } from '../api-error';
	import InverterStatusBadge from '../inverter-status-badge.svelte';
	import type { InverterStatus } from '../inverter-types';
	import AddDeviceDialog from './add-device-dialog.svelte';
	import ConnectionDialog from './connection-dialog.svelte';
	import DeviceList from './device-list.svelte';
	import type { ConnectionView, DeviceRoster, DeviceView } from './device-types';
	import RetireDialog from './retire-dialog.svelte';

	// The devices panel: the plant's gateways and the devices on each, retired
	// ones included (a device the UI cannot see is a device nobody can restore),
	// and the one way to add to it. The header badge is the poll loop's health —
	// the one link this release drives.
	let { status = null }: { status?: InverterStatus | null } = $props();

	let roster = $state<DeviceRoster | null>(null);
	let loadFailed = $state(false);
	let busyId = $state<number | null>(null);
	let dialogOpen = $state(false);
	/** The device the dialog edits, or null when it adds. */
	let editing = $state<DeviceView | null>(null);
	let connection = $state<ConnectionView | null>(null);
	let retiring = $state<DeviceView | null>(null);

	const onConnection = $derived(
		roster && connection ? roster.devices.filter((d) => d.connectionId === connection?.id) : []
	);

	async function load() {
		const { data, error } = await api.api.devices.get();
		loadFailed = Boolean(error);
		if (data) roster = data as DeviceRoster;
	}

	onMount(load);

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
</script>

<div class="flex flex-col gap-6">
	<Section title={m.devices_section_title()}>
		{#snippet actions()}
			<InverterStatusBadge {status} />
			<Button size="sm" class="h-9 sm:h-8" onclick={() => openDialog(null)} disabled={!roster}>
				{m.devices_add()}
			</Button>
		{/snippet}
		<DeviceList
			{roster}
			{loadFailed}
			{busyId}
			onEditConnection={(c) => (connection = c)}
			onEdit={openDialog}
			onRetire={(d) => (retiring = d)}
			onRestore={(d) => setRetired(d, false)}
		/>
	</Section>
</div>

{#if roster}
	<AddDeviceDialog
		bind:open={dialogOpen}
		device={editing}
		connections={roster.connections}
		devices={roster.devices}
		onSaved={load}
	/>
	<ConnectionDialog bind:connection devices={onConnection} onSaved={load} onDeleted={load} />
{/if}

<RetireDialog device={retiring} onCancel={() => (retiring = null)} onConfirm={confirmRetire} />
