<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { DeviceView } from './device-types';

	// Where the device lives: its frozen slug, its profile, its unit id. The
	// gateway is the group header above it, not repeated per row.
	//
	// The `·` separators are CSS on every item but the first, never text nodes.
	// As interleaved `<span>·</span>`s they were flex items like any other, so a
	// wrap put one at the end of a line — "Unit 0 ·" — the moment "Profile not
	// installed (evcc-loadpoint)" pushed the row over (#214). A leading separator
	// cannot dangle: it wraps with the item it belongs to.
	let { device }: { device: DeviceView } = $props();

	const kwp = $derived(device.arrays.reduce((sum, a) => sum + a.kwp, 0));
	const summary = $derived.by(() => {
		const parts: string[] = [];
		if (kwp > 0) parts.push(m.devices_meta_kwp({ kwp: String(Math.round(kwp * 100) / 100) }));
		if (device.battery) parts.push(m.devices_meta_kwh({ kwh: String(device.battery.usableKwh) }));
		return parts;
	});
</script>

<span
	data-slot="device-meta"
	class="flex flex-wrap gap-x-2 text-xs text-muted-foreground [&>*:not(:first-child)]:before:mr-2 [&>*:not(:first-child)]:before:content-['·']"
>
	<span class="font-mono">{device.slug}</span>
	{#if device.profileKnown}
		<span>{device.profileName}</span>
	{:else}
		<span class="text-destructive">{m.devices_profile_missing()} ({device.profileId})</span>
	{/if}
	<span>{m.devices_unit({ id: device.unitId })}</span>
	{#each summary as part (part)}
		<span>{part}</span>
	{/each}
</span>
