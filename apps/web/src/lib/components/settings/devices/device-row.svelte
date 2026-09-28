<script lang="ts">
	import DeviceActions from './device-actions.svelte';
	import DeviceMeta from './device-meta.svelte';
	import DeviceNameLine from './device-name-line.svelte';
	import type { DeviceHandlers, DeviceView } from './device-types';

	// One device of its group: identity on the left (name, role, state, where it
	// lives), its one visible control and the overflow menu on the right.
	//
	// Side by side at EVERY width. The row used to stack below `sm` with two
	// full-width buttons under each device; with one button and a "⋯" the
	// controls fit beside a wrapping name at 400px, and a phone shows the roster
	// instead of a column of buttons.
	let {
		device,
		busy,
		handlers
	}: {
		device: DeviceView;
		busy: boolean;
		handlers: DeviceHandlers;
	} = $props();
</script>

<div
	class="flex items-center justify-between gap-3 py-3 sm:gap-4"
	class:opacity-60={device.retiredAt !== null}
	data-device={device.slug}
>
	<div class="flex min-w-0 flex-col gap-1">
		<DeviceNameLine {device} />
		<DeviceMeta {device} />
	</div>
	<DeviceActions {device} {busy} {handlers} />
</div>
