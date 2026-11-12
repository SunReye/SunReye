<!--
	Local: the list of link tabs (tabs-link.svelte) as a <nav>, styled as
	a `nav` tabs list. Route tabs need no Tabs.Root: the URL is the state.
	The current link's underline slides between links (trackIndicator, #8).
-->
<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "#lib/utils.js";
	import { tabsListVariants } from "./tabs-list.svelte";
	import { trackIndicator } from "./tabs-motion.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLElement>> = $props();
</script>

<nav
	bind:this={ref}
	{@attach trackIndicator}
	data-slot="tabs-list"
	data-variant="nav"
	class={cn(tabsListVariants({ variant: "nav" }), className)}
	{...restProps}
>
	{@render children?.()}
</nav>
