<script lang="ts">
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { SECTION_GAP } from '$lib/layout/tokens';
	import { groupByConnection } from './add-device-logic';
	import DeviceGroupCard from './device-group.svelte';
	import type { ConnectionView, DeviceRoster, DeviceView, IntegrationView } from './device-types';

	// The roster's three states — failed to load, empty, groups — and the groups.
	let {
		roster,
		loadFailed,
		busyId,
		busyIntegrationId,
		onEditConnection,
		onEdit,
		onRename,
		onRetire,
		onRestore,
		onEditIntegration,
		onToggleIntegration,
		onRemoveIntegration
	}: {
		roster: DeviceRoster | null;
		loadFailed: boolean;
		busyId: number | null;
		busyIntegrationId: number | null;
		onEditConnection: (connection: ConnectionView) => void;
		onEdit: (device: DeviceView) => void;
		onRename: (device: DeviceView) => void;
		onRetire: (device: DeviceView) => void;
		onRestore: (device: DeviceView) => void;
		onEditIntegration: (integration: IntegrationView) => void;
		onToggleIntegration: (integration: IntegrationView, enabled: boolean) => void;
		onRemoveIntegration: (integration: IntegrationView) => void;
	} = $props();

	const groups = $derived(roster ? groupByConnection(roster) : []);
	const empty = $derived(roster !== null && groups.length === 0);
</script>

{#if loadFailed}
	<EmptyState message={m.devices_load_failed()} />
{:else if empty}
	<EmptyState message={m.devices_empty()} />
{:else}
	<div class="flex flex-col {SECTION_GAP}">
		{#each groups as group (group.key)}
			<DeviceGroupCard
				{group}
				{busyId}
				{busyIntegrationId}
				{onEditConnection}
				{onEdit}
				{onRename}
				{onRetire}
				{onRestore}
				{onEditIntegration}
				{onToggleIntegration}
				{onRemoveIntegration}
			/>
		{/each}
	</div>
{/if}
