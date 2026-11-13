<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";
	import { cn } from "#lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: MenubarPrimitive.TriggerProps = $props();
</script>

<MenubarPrimitive.Trigger
	bind:ref
	data-slot="menubar-trigger"
	// Local: the highlight fades; full height on touch (ADR 21, #750).
	class={cn("hover:bg-muted aria-expanded:bg-muted rounded-sm px-2 py-1 touch:h-full text-sm font-medium transition-colors flex items-center outline-hidden select-none", className)}
	{...restProps}
/>
