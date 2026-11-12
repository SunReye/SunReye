<!-- Local: a `size` variant (default, square, hairline). No colour tones: those need a project's data colours. -->
<script lang="ts" module>
	import { tv, type VariantProps } from "tailwind-variants";

	export const progressVariants = tv({
		base: "bg-muted relative flex w-full items-center overflow-x-hidden",
		variants: {
			size: {
				default: "h-1.5 rounded-full",
				square: "h-1.5 rounded-none",
				hairline: "h-1 rounded-none",
			},
		},
		defaultVariants: {
			size: "default",
		},
	});

	export type ProgressSize = VariantProps<typeof progressVariants>["size"];
</script>

<script lang="ts">
	import { Progress as ProgressPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "#lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		max = 100,
		value,
		// Local: the `size` variant.
		size = "default",
		...restProps
		// Local: props type gains the `size` variant.
	}: WithoutChildrenOrChild<ProgressPrimitive.RootProps> & {
		size?: ProgressSize;
	} = $props();
</script>

<ProgressPrimitive.Root
	bind:ref
	data-slot="progress"
	// Local: classes from progressVariants (the `size` variant).
	class={cn(progressVariants({ size }), className)}
	{value}
	{max}
	{...restProps}
>
	<div
		data-slot="progress-indicator"
		// Local: the fill glides to a new value on --motion-slow, as a transform only (upstream's transition-all would also animate size), #38.
		class="bg-primary size-full flex-1 transition-transform duration-(--motion-slow)"
		style="transform: translateX(-{100 - (100 * (value ?? 0)) / (max ?? 1)}%)"
	></div>
</ProgressPrimitive.Root>
