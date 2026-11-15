<script lang="ts">
	import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "#lib/utils.js";
	import ContextMenuPortal from "./context-menu-portal.svelte";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		align = "start",
		alignOffset = -3,
		portalProps,
		...restProps
	}: ContextMenuPrimitive.SubContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof ContextMenuPortal>>;
	} = $props();
</script>

<ContextMenuPortal {...portalProps}>
	<ContextMenuPrimitive.SubContent
		bind:ref
		data-slot="context-menu-sub-content"
		{align}
		{alignOffset}
		class={cn(
			// Local: the app's overlay glass, spring-in and elevation, timed by the motion tokens, instead of upstream's bg-popover, zoom, shadow and duration-100 (ADR 21, #750).
			"data-open:animate-spring-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 glass text-popover-foreground min-w-32 rounded-md border p-1 elevation-3 duration-(--motion-base) ease-(--motion-ease) z-50 origin-(--bits-context-menu-content-transform-origin) overflow-hidden",
			className
		)}
		{...restProps}
	/>
</ContextMenuPortal>
