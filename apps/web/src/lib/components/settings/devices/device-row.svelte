<script lang="ts">
	import DeviceActions from './device-actions.svelte';
	import DeviceMeta from './device-meta.svelte';
	import DeviceNameLine from './device-name-line.svelte';
	import type { DeviceView } from './device-types';

	// One device of its group: identity on the left (name, role, state, where it
	// lives), the operator's controls on the right. Editing and renaming are the
	// dialogs' job; retire and restore are the parent's, since retiring asks
	// first.
	let {
		device,
		busy,
		onEdit,
		onRename,
		onRetire,
		onRestore
	}: {
		device: DeviceView;
		busy: boolean;
		onEdit: (device: DeviceView) => void;
		onRename: (device: DeviceView) => void;
		onRetire: (device: DeviceView) => void;
		onRestore: (device: DeviceView) => void;
	} = $props();
</script>

<div
	class="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
	class:opacity-60={device.retiredAt !== null}
	data-device={device.slug}
>
	<div class="flex min-w-0 flex-col gap-1">
		<DeviceNameLine {device} />
		<DeviceMeta {device} />
	</div>
	<DeviceActions {device} {busy} {onEdit} {onRename} {onRetire} {onRestore} />
</div>
