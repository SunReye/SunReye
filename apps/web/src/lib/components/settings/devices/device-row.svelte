<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import DeviceActions from './device-actions.svelte';
	import DeviceMeta from './device-meta.svelte';
	import DeviceStateBadge from './device-state-badge.svelte';
	import type { DeviceView } from './device-types';
	import RenameForm from './rename-form.svelte';
	import { roleLabel } from './role-label';

	// One device of the roster: identity on the left (name, role, state, where it
	// lives), the operator's controls on the right. Rename swaps the identity for
	// an inline form; retire and restore are the parent's, since retiring asks
	// for confirmation first.
	let {
		device,
		busy,
		onRename,
		onRetire,
		onRestore
	}: {
		device: DeviceView;
		busy: boolean;
		onRename: (device: DeviceView, name: string) => Promise<void>;
		onRetire: (device: DeviceView) => void;
		onRestore: (device: DeviceView) => void;
	} = $props();

	let editing = $state(false);

	async function save(name: string) {
		await onRename(device, name);
		editing = false;
	}
</script>

<div
	class="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
	class:opacity-60={device.retiredAt !== null}
	data-device={device.slug}
>
	<div class="flex min-w-0 flex-col gap-1">
		{#if editing}
			<RenameForm current={device.name} {busy} onSave={save} onCancel={() => (editing = false)} />
		{:else}
			<span class="flex flex-wrap items-center gap-1.5 text-sm font-medium">
				<span class="wrap-break-word">{device.name}</span>
				<Badge variant="outline">{roleLabel(device.role)}</Badge>
				<DeviceStateBadge {device} />
			</span>
		{/if}
		<DeviceMeta {device} />
	</div>
	{#if !editing}
		<DeviceActions {device} {busy} onRename={() => (editing = true)} {onRetire} {onRestore} />
	{/if}
</div>
