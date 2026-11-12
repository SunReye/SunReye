<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	// Local: sliding selection indicator for `list` rows (#46).
	import { trackActive } from "#lib/motion.js";

	// Local: the accent and the primary bar of the current `list` row, drawn here from trackActive's
	// box so they slide and resize from row to row on the motion tokens (#46). `before` is the
	// accent, under the rows; `after` the bar, over the row's left padding.
	const indicator =
		"relative before:pointer-events-none after:pointer-events-none before:absolute after:absolute before:hidden after:hidden data-indicator:before:block data-indicator:after:block before:left-(--item-indicator-left) after:left-(--item-indicator-left) before:top-(--item-indicator-top) after:top-(--item-indicator-top) before:w-(--item-indicator-width) before:h-(--item-indicator-height) after:h-(--item-indicator-height) after:w-1 before:bg-accent after:bg-primary before:transition-[left,top,width,height] after:transition-[left,top,width,height] before:duration-(--motion-base) after:duration-(--motion-base) before:ease-(--motion-ease) after:ease-(--motion-ease)";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();

	// Local: sliding selection indicator for `list` rows (#46).
	$effect(() =>
		ref
			? trackActive(ref, {
					active: '[data-slot="item"][data-variant="list"][aria-current="true"]',
					prefix: "item",
					attributes: ["aria-current"],
					paddingBox: true,
				})
			: undefined
	);
</script>

<div
	bind:this={ref}
	role="list"
	data-slot="item-group"
	// Local: rows of the `list` variant sit flush; they carry the sliding indicator (#46).
	class={cn(indicator, "gap-4 has-data-[variant=list]:gap-0 has-data-[size=sm]:gap-2.5 has-data-[size=xs]:gap-2 group/item-group flex w-full flex-col", className)}
	{...restProps}
>
	{@render children?.()}
</div>
