<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import Section from '$lib/components/layout/section.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { type ConnectionGroup, connectionCaption } from './add-device-logic';
	import DeviceRow from './device-row.svelte';
	import type { ConnectionView, DeviceView } from './device-types';

	// One gateway and the devices reached through it, as a collapsible card. The
	// gateway is edited from HERE, not from one of its devices: one save moves
	// every device below, and the header is where that is visible. With
	// `connection` null this is the endpoint-less group, which has no header
	// actions — there is nothing to edit.
	let {
		group,
		busyId,
		onEditConnection,
		onEdit,
		onRetire,
		onRestore
	}: {
		group: ConnectionGroup;
		busyId: number | null;
		onEditConnection: (connection: ConnectionView) => void;
		onEdit: (device: DeviceView) => void;
		onRetire: (device: DeviceView) => void;
		onRestore: (device: DeviceView) => void;
	} = $props();

	const connection = $derived(group.connection);
	const title = $derived(connection ? connection.name : m.devices_group_no_connection());
	const caption = $derived(connection ? m.devices_group_caption(connectionCaption(connection)) : undefined);
	const key = $derived(connection ? String(connection.id) : 'none');
	const empty = $derived(group.devices.length === 0);
</script>

<Section {title} {caption} nested collapsible open>
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
		<div class="flex flex-col divide-y divide-border" data-connection={key}>
			{#each group.devices as device (device.id)}
				<DeviceRow {device} busy={busyId === device.id} {onEdit} {onRetire} {onRestore} />
			{/each}
		</div>
	{/if}
</Section>
