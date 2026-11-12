<script lang="ts" module>
	import { getContext, setContext } from "svelte";
	import { toggleVariants } from "#lib/components/ui/toggle/index.js";
	import type { VariantProps } from "tailwind-variants";

	type ToggleVariants = VariantProps<typeof toggleVariants>;

	interface ToggleGroupContext extends ToggleVariants {
		spacing?: number;
		orientation?: "horizontal" | "vertical";
	}

	export function setToggleGroupCtx(props: ToggleGroupContext) {
		setContext("toggleGroup", props);
	}

	export function getToggleGroupCtx() {
		return getContext<Required<ToggleGroupContext>>("toggleGroup");
	}
</script>

<script lang="ts">
	import { ToggleGroup as ToggleGroupPrimitive } from "bits-ui";
	import { cn } from "#lib/utils.js";
	// Local: sliding pressed box of a `single` group (#49).
	import { trackActive } from "#lib/motion.js";

	// Local: the pressed look of a `single` group, drawn here from trackActive's box so it slides and
	// resizes from item to item on the motion tokens (#49). It is `before`, under the items (they are
	// `relative`) and over the group's own shadow; `hairline` pressed is accent, the others muted.
	// The items stop painting their own pressed background once the group has measured.
	const pressed =
		"relative before:pointer-events-none before:absolute before:hidden data-indicator:before:block before:left-(--toggle-group-indicator-left) before:top-(--toggle-group-indicator-top) before:w-(--toggle-group-indicator-width) before:h-(--toggle-group-indicator-height) before:rounded-(--toggle-group-indicator-radius) before:bg-muted data-[variant=hairline]:before:bg-accent before:transition-[left,top,width,height,border-radius] before:duration-(--motion-base) before:ease-(--motion-ease)";

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		// Local: `single` groups slide the pressed box; `multiple` ones keep each item's own look (#49).
		type,
		size = "default",
		spacing = 0,
		orientation = "horizontal",
		variant = "default",
		...restProps
	}: ToggleGroupPrimitive.RootProps &
		ToggleVariants & {
			spacing?: number;
			orientation?: "horizontal" | "vertical";
		} = $props();

	// Local: sliding pressed box of a `single` group (#49).
	$effect(() =>
		ref && type === "single"
			? trackActive(ref, {
					active: '[data-slot="toggle-group-item"][data-state="on"]',
					prefix: "toggle-group",
					attributes: ["data-state", "data-orientation", "data-spacing"],
					radius: true,
				})
			: undefined
	);

	setToggleGroupCtx({
		get variant() {
			return variant;
		},
		get size() {
			return size;
		},
		get spacing() {
			return spacing;
		},
		get orientation() {
			return orientation;
		},
	});
</script>

<!--
Discriminated Unions + Destructing (required for bindable) do not
get along, so we shut typescript up by casting `value` to `never`.
-->
<ToggleGroupPrimitive.Root
	bind:value={value as never}
	// Local: the type is destructured above, so it is passed on by hand (#49).
	type={type as never}
	bind:ref
	{orientation}
	data-slot="toggle-group"
	data-variant={variant}
	data-size={size}
	data-spacing={spacing}
	style={`--gap: ${spacing}`}
	class={cn(
		// Local: `single` groups carry the sliding pressed box (#49).
		type === "single" && pressed,
		// Local: no shadow-xs on the joined outline group, a toggle-group is a dense surface (#58).
		"rounded-md group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] data-vertical:flex-col data-vertical:items-stretch",
		className
	)}
	{...restProps}
/>
