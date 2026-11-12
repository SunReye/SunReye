<script lang="ts" module>
	import { tv, type VariantProps } from "tailwind-variants";

	export const itemVariants = tv({
		// Local: duration from the motion item, not upstream's duration-100 (ADR 0003).
		base: "[a]:hover:bg-muted rounded-md border text-sm group/item flex w-full flex-wrap items-center transition-colors duration-(--motion-base) outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [a]:transition-colors",
		variants: {
			variant: {
				default: "border-transparent",
				outline: "border-border",
				muted: "bg-muted/50 border-transparent",
				// Local: `list` variant: square rows on hairlines, accent and a primary bar when aria-current. Inside an `Item.Group` the group draws both as one sliding indicator (#46); the row paints them itself only until the group has measured (server render, no script) or when there is no group.
				list: "relative rounded-none border-0 border-b border-border aria-[current=true]:bg-accent group-data-indicator/item-group:aria-[current=true]:bg-transparent before:absolute before:inset-y-0 before:left-0 before:w-1 aria-[current=true]:before:bg-primary group-data-indicator/item-group:aria-[current=true]:before:bg-transparent",
			},
			size: {
				default: "gap-3.5 px-4 py-3.5",
				sm: "gap-2.5 px-3 py-2.5",
				xs: "gap-2 px-2.5 py-2 in-data-[slot=dropdown-menu-content]:p-0",
				// Local: `list` / `list-sm` sizes for the `list` variant.
				list: "gap-x-3 gap-y-0 py-3 pr-4 pl-5",
				"list-sm": "gap-x-3 gap-y-0 py-2 pr-4 pl-5",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	});

	export type ItemSize = VariantProps<typeof itemVariants>["size"];

	export type ItemVariant = VariantProps<typeof itemVariants>["variant"];
</script>

<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		child,
		variant,
		size,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		child?: Snippet<[{ props: Record<string, unknown> }]>;
		variant?: ItemVariant;
		size?: ItemSize;
	} = $props();

	const mergedProps = $derived({
		class: cn(itemVariants({ variant, size }), className),
		"data-slot": "item",
		"data-variant": variant,
		"data-size": size,
		...restProps,
	});
</script>

{#if child}
	{@render child({ props: mergedProps })}
{:else}
	<div bind:this={ref} {...mergedProps}>
		{@render mergedProps.children?.()}
	</div>
{/if}
