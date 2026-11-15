<script lang="ts">
	import { Select as SelectPrimitive } from "bits-ui";
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { cn, type WithoutChild } from "#lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = "default",
		...restProps
	}: WithoutChild<SelectPrimitive.TriggerProps> & {
		size?: "sm" | "default";
	} = $props();
</script>

<SelectPrimitive.Trigger
	bind:ref
	data-slot="select-trigger"
	data-size={size}
	class={cn(
		// Local: a soft glow on hover and focus, fading with the ring on --motion-base (#47); a shallow inset well instead of upstream's shadow-xs (#58). Tabular figures and 44 px on touch (ADR 21, #750).
		"border-input data-placeholder:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 gap-1.5 rounded-md border bg-transparent py-2 pr-2 pl-2.5 text-sm bevel-well transition-[color,box-shadow] duration-(--motion-base) glow focus-visible:ring-3 aria-invalid:ring-3 data-[size=default]:h-9 touch:data-[size=default]:h-11 data-[size=sm]:h-8 tabular-nums *:data-[slot=select-value]:flex *:data-[slot=select-value]:gap-1.5 [&_svg:not([class*='size-'])]:size-4 flex w-fit items-center justify-between whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-50 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<!-- Local: the chevron turns over while the list is open, on the default transition (#38). -->
	<ChevronDownIcon class="text-muted-foreground size-4 pointer-events-none transition-transform [[data-state=open]>&]:rotate-180" />
</SelectPrimitive.Trigger>
