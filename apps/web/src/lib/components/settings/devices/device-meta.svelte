<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { DeviceView } from './device-types';

	// Where the device lives: its frozen slug, its profile, its gateway, its unit id.
	let { device }: { device: DeviceView } = $props();

	const address = $derived(
		device.connection
			? `${device.connection.name} · ${device.connection.host}:${device.connection.port}`
			: m.devices_no_connection()
	);
</script>

<span class="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
	<span class="font-mono">{device.slug}</span>
	<span>·</span>
	{#if device.profileKnown}
		<span>{device.profileName}</span>
	{:else}
		<span class="text-destructive">{m.devices_profile_missing()} ({device.profileId})</span>
	{/if}
	<span>·</span>
	<span>{address}</span>
	<span>·</span>
	<span>{m.devices_unit({ id: device.unitId })}</span>
</span>
