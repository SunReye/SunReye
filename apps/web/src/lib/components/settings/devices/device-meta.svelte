<script lang="ts">
	import { deviceMetaParts } from './device-meta-parts';
	import type { DeviceView } from './device-types';

	// Where the device lives. WHICH parts those are is `deviceMetaParts`' decision
	// and its test's — notably that the frozen slug is not one of them on any
	// kind of device, and that a unit id belongs only to a device genuinely
	// addressed by one. This renders the list and nothing else.
	//
	// The `·` separators are CSS on every item but the first, never text nodes.
	// As interleaved `<span>·</span>`s they were flex items like any other, so a
	// wrap put one at the end of a line — "Unit 0 ·" — the moment "Profile not
	// installed (evcc-loadpoint)" pushed the row over (#214). A leading separator
	// cannot dangle: it wraps with the item it belongs to.
	let { device }: { device: DeviceView } = $props();

	const parts = $derived(deviceMetaParts(device));
</script>

<span
	data-slot="device-meta"
	class="flex flex-wrap gap-x-2 text-xs text-muted-foreground [&>*:not(:first-child)]:before:mr-2 [&>*:not(:first-child)]:before:content-['·']"
>
	{#each parts as part (part.text)}
		<span class={part.missing ? 'text-destructive' : ''}>{part.text}</span>
	{/each}
</span>
