<script lang="ts">
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { SECTION_GAP } from '$lib/layout/tokens';
	import type { DeviceGroup } from './roster-groups';
	import DeviceGroupCard from './device-group.svelte';
	import type { ConnectionView, DeviceHandlers, IntegrationHandlers } from './device-types';

	// The roster's three states — failed to load, empty, groups — and the groups.
	let {
		groups,
		loaded,
		loadFailed,
		busyId,
		busyIntegrationId,
		onEditConnection,
		handlers,
		integrationHandlers
	}: {
		/** The roster's cards, integrations folded in (`DeviceRoster.groups`). */
		groups: DeviceGroup[];
		/** Whether the roster has answered — no cards before it is "not yet", not "empty". */
		loaded: boolean;
		loadFailed: boolean;
		busyId: number | null;
		busyIntegrationId: number | null;
		onEditConnection: (connection: ConnectionView) => void;
		handlers: DeviceHandlers;
		integrationHandlers: IntegrationHandlers;
	} = $props();

	const empty = $derived(loaded && groups.length === 0);
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
				{handlers}
				{integrationHandlers}
			/>
		{/each}
	</div>
{/if}
