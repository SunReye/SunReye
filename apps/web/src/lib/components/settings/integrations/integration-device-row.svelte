<script lang="ts">
	import DeviceNameLine from '../devices/device-name-line.svelte';
	import type { DeviceView } from '../devices/device-types';
	import { deviceAddress } from './integration-detail';

	// ONE device this integration provides.
	//
	// This is where the identifiers live. The devices page dropped the frozen
	// slug from its rows because a database column is not an explanation; it did
	// not delete the fact, it moved it here, to the page an operator reaches when
	// they actually need to match a row against a topic or a log line.
	//
	// "How it is addressed" is `deviceAddress`' decision: a Modbus slave id, an
	// index in the integration's own config, or nothing at all — three genuinely
	// different answers that calling all of them "Unit" used to blur.
	let { device }: { device: DeviceView } = $props();
</script>

<div
	class="flex flex-col gap-1 py-3"
	class:opacity-60={device.retiredAt !== null}
	data-provided-device={device.slug}
>
	<DeviceNameLine {device} />
	<span
		class="flex flex-wrap gap-x-2 text-xs text-muted-foreground [&>*:not(:first-child)]:before:mr-2 [&>*:not(:first-child)]:before:content-['·']"
	>
		<span class="font-mono wrap-break-word">{device.slug}</span>
		<span>{deviceAddress(device)}</span>
	</span>
</div>
