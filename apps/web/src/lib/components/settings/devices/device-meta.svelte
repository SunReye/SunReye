<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { DeviceView } from './device-types';

	// Where the device lives: its frozen slug, its profile, its unit id. The
	// gateway is the group header above it, not repeated per row.
	let { device }: { device: DeviceView } = $props();
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
	<span>{m.devices_unit({ id: device.unitId })}</span>
</span>
