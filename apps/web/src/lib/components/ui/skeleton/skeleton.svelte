<script lang="ts">
	import { cn, type WithElementRef, type WithoutChildren } from "#lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildren<WithElementRef<HTMLAttributes<HTMLDivElement>>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="skeleton"
	// Local: the pulse stops under prefers-reduced-motion, which neither Tailwind nor tw-animate-css does for animate-pulse (#28, PR #26 review).
	class={cn("bg-muted rounded-md animate-pulse motion-reduce:animate-none", className)}
	{...restProps}
></div>
