<script lang="ts">
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { groupByConnection } from './add-device-logic';
	import ConnectionGroup from './connection-group.svelte';
	import type { ConnectionView, DeviceRoster, DeviceView } from './device-types';

	// The roster's three states — failed to load, empty, groups — and the groups.
	let {
		roster,
		loadFailed,
		busyId,
		onEditConnection,
		onEdit,
		onRetire,
		onRestore
	}: {
		roster: DeviceRoster | null;
		loadFailed: boolean;
		busyId: number | null;
		onEditConnection: (connection: ConnectionView) => void;
		onEdit: (device: DeviceView) => void;
		onRetire: (device: DeviceView) => void;
		onRestore: (device: DeviceView) => void;
	} = $props();

	const groups = $derived(roster ? groupByConnection(roster) : []);
	const empty = $derived(roster !== null && groups.length === 0);
</script>

{#if loadFailed}
	<EmptyState message={m.devices_load_failed()} />
{:else if empty}
	<EmptyState message={m.devices_empty()} />
{:else}
	<div class="flex flex-col gap-4">
		{#each groups as group (group.connection?.id ?? 'none')}
			<ConnectionGroup {group} {busyId} {onEditConnection} {onEdit} {onRetire} {onRestore} />
		{/each}
	</div>
{/if}
