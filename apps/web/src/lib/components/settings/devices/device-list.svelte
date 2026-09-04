<script lang="ts">
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import DeviceRow from './device-row.svelte';
	import type { DeviceRoster, DeviceView } from './device-types';

	// The roster's three states — failed to load, empty, rows — and the rows.
	let {
		roster,
		loadFailed,
		busyId,
		onRename,
		onRetire,
		onRestore
	}: {
		roster: DeviceRoster | null;
		loadFailed: boolean;
		busyId: number | null;
		onRename: (device: DeviceView, name: string) => Promise<void>;
		onRetire: (device: DeviceView) => void;
		onRestore: (device: DeviceView) => void;
	} = $props();

	const devices = $derived(roster?.devices ?? []);
	const empty = $derived(roster !== null && devices.length === 0);
</script>

{#if loadFailed}
	<EmptyState message={m.devices_load_failed()} />
{:else if empty}
	<EmptyState message={m.devices_empty()} />
{:else}
	<div class="flex flex-col divide-y divide-border">
		{#each devices as device (device.id)}
			<DeviceRow {device} busy={busyId === device.id} {onRename} {onRetire} {onRestore} />
		{/each}
	</div>
{/if}
