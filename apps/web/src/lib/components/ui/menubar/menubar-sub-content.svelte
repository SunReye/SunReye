<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "#lib/utils.js";
	import MenubarPortal from "./menubar-portal.svelte";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		align = "start",
		alignOffset = -3,
		portalProps,
		...restProps
	}: MenubarPrimitive.SubContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof MenubarPortal>>;
	} = $props();
</script>

<MenubarPortal {...portalProps}>
	<MenubarPrimitive.SubContent
		bind:ref
		data-slot="menubar-sub-content"
		{align}
		{alignOffset}
		class={cn(
			// Local: the app's overlay glass, spring-in and elevation, timed by the motion tokens, instead of upstream's bg-popover, zoom, shadow and duration-100 (ADR 21, #750).
			"glass text-popover-foreground data-open:animate-spring-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 min-w-32 rounded-md p-1 elevation-3 ring-1 duration-(--motion-base) ease-(--motion-ease) z-50 origin-(--bits-menubar-content-transform-origin) overflow-hidden",
			className
		)}
		{...restProps}
	/>
</MenubarPortal>
