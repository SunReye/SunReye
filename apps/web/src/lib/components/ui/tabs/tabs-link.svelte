<!--
	Local: a tab that navigates. Route-level tabs are links in a <nav>
	(aria-current marks the current one), styled as triggers of a `nav` tabs list.
-->
<script lang="ts">
	import type { HTMLAnchorAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "#lib/utils.js";

	let {
		ref = $bindable(null),
		current = false,
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAnchorAttributes> & { current?: boolean } = $props();
</script>

<a
	bind:this={ref}
	data-slot="tabs-link"
	data-active={current ? "" : undefined}
	aria-current={current ? "page" : undefined}
	class={cn(
		"text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 relative inline-flex h-full items-center gap-2 border-b-2 border-transparent px-4 text-[13px] whitespace-nowrap transition-colors duration-(--motion-base) outline-none focus-visible:ring-[3px] focus-visible:ring-inset",
		"data-active:border-primary data-active:text-primary data-active:font-semibold",
		// Once the nav draws the sliding indicator (#8), the current link drops its own underline.
		"group-data-indicator/tabs-list:data-active:border-transparent!",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</a>
