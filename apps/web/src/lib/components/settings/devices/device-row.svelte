<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import DeviceActions from './device-actions.svelte';
	import DeviceMeta from './device-meta.svelte';
	import DeviceStateBadge from './device-state-badge.svelte';
	import type { DeviceView } from './device-types';
	import { roleLabel } from './role-label';

	// One device of its gateway's group: identity on the left (name, role, state,
	// where it lives), the operator's controls on the right. Editing is the
	// dialog's job; retire and restore are the parent's, since retiring asks first.
	let {
		device,
		busy,
		onEdit,
		onRetire,
		onRestore
	}: {
		device: DeviceView;
		busy: boolean;
		onEdit: (device: DeviceView) => void;
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
		<span class="flex flex-wrap items-center gap-1.5 text-sm font-medium">
			<span class="wrap-break-word">{device.name}</span>
			<Badge variant="outline">{roleLabel(device.role)}</Badge>
			<DeviceStateBadge {device} />
		</span>
		<DeviceMeta {device} />
	</div>
	<DeviceActions {device} {busy} {onEdit} {onRetire} {onRestore} />
</div>
