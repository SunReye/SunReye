<script lang="ts">
	import DeviceRow from './device-row.svelte';
	import type { DeviceView } from './device-types';

	// The devices half of a connection's card: what READS through the endpoint,
	// as opposed to the integrations that RUN over it.
	//
	// Its own component, and the exact shape of `./integration-list.svelte`
	// beside it, so the card's own template holds two children and no branch. A
	// half that renders nothing when it is empty is the half's own business —
	// pushing that `{#if}` up put the group's template over the complexity
	// ceiling the moment the second half arrived.
	let {
		devices,
		busyId,
		groupKey,
		onEdit,
		onRename,
		onRetire,
		onRestore
	}: {
		devices: readonly DeviceView[];
		busyId: number | null;
		/** The `data-group` handle a spec addresses this half by. */
		groupKey: string;
		onEdit: (device: DeviceView) => void;
		onRename: (device: DeviceView) => void;
		onRetire: (device: DeviceView) => void;
		onRestore: (device: DeviceView) => void;
	} = $props();
</script>

{#if devices.length > 0}
	<div class="flex flex-col divide-y divide-border" data-group={groupKey}>
		{#each devices as device (device.id)}
			<DeviceRow {device} busy={busyId === device.id} {onEdit} {onRename} {onRetire} {onRestore} />
		{/each}
	</div>
{/if}
