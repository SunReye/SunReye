<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import Section from '$lib/components/layout/section.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { type DeviceGroup, connectionCaption } from './add-device-logic';
	import DeviceRow from './device-row.svelte';
	import type { ConnectionView, DeviceView } from './device-types';

	// One group of the roster as a collapsible card: a gateway and the devices
	// reached through it, an integration and the devices it feeds, the internal
	// devices, or the ones with no endpoint and no reason for it.
	//
	// A gateway is edited from HERE, not from one of its devices: one save moves
	// every device below, and the header is where that is visible. The other three
	// kinds have no header actions — there is nothing on a group of them to edit.
	let {
		group,
		busyId,
		onEditConnection,
		onEdit,
		onRetire,
		onRestore
	}: {
		group: DeviceGroup;
		busyId: number | null;
		onEditConnection: (connection: ConnectionView) => void;
		onEdit: (device: DeviceView) => void;
		onRetire: (device: DeviceView) => void;
		onRestore: (device: DeviceView) => void;
	} = $props();

	const connection = $derived(group.connection);
	const caption = $derived(
		connection ? m.devices_group_caption(connectionCaption(connection)) : undefined
	);
	const empty = $derived(group.devices.length === 0);
</script>

<Section title={group.title} {caption} nested collapsible open>
	{#snippet actions()}
		{#if connection}
			<Button size="sm" variant="outline" onclick={() => onEditConnection(connection)}>
				{m.devices_edit_connection()}
			</Button>
		{/if}
	{/snippet}
	{#if empty}
		<EmptyState message={m.devices_empty()} />
	{:else}
		<div class="flex flex-col divide-y divide-border" data-group={group.key}>
			{#each group.devices as device (device.id)}
				<DeviceRow {device} busy={busyId === device.id} {onEdit} {onRetire} {onRestore} />
			{/each}
		</div>
	{/if}
</Section>
