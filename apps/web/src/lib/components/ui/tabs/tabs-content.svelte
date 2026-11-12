<script lang="ts">
	import { Tabs as TabsPrimitive } from "bits-ui";
	import { cn } from "#lib/utils.js";
	// Local: content crossfade on a switch (#8).
	import { crossfade } from "./tabs-motion.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: TabsPrimitive.ContentProps = $props();

	// Local: content crossfade on a switch (#8).
	$effect(() => (ref ? crossfade(ref) : undefined));
</script>

<TabsPrimitive.Content
	bind:ref
	data-slot="tabs-content"
	class={cn("text-sm flex-1 outline-none", className)}
	{...restProps}
/>
