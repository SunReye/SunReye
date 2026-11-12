<script lang="ts" module>
	import { tv, type VariantProps } from "tailwind-variants";

	export const tabsListVariants = tv({
		// Local: `relative` and the sliding active indicator, drawn from trackIndicator's box (tabs-motion.ts, #8); it slides on the spring (#47).
		base: "relative before:absolute before:hidden data-indicator:before:block before:left-(--tabs-indicator-left) before:top-(--tabs-indicator-top) before:w-(--tabs-indicator-width) before:h-(--tabs-indicator-height) before:transition-[left,top,width,height] before:duration-(--motion-base) before:ease-(--motion-ease) rounded-lg p-[3px] group-data-horizontal/tabs:h-9 data-[variant=line]:rounded-none group/tabs-list inline-flex w-fit items-center justify-center text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
		variants: {
			variant: {
				// Local: indicator looks, matching the active trigger's own (#8); no before:shadow-sm, tabs are a dense surface (#58).
				default: "bg-muted before:rounded-md before:bg-background dark:before:border dark:before:border-input dark:before:bg-input/30",
				line: "gap-1 bg-transparent before:bg-foreground group-data-horizontal/tabs:before:top-[calc(var(--tabs-indicator-top)+var(--tabs-indicator-height)+3px)] group-data-horizontal/tabs:before:h-0.5 group-data-vertical/tabs:before:left-[calc(var(--tabs-indicator-left)+var(--tabs-indicator-width)+2px)] group-data-vertical/tabs:before:w-0.5",
				// Local: `nav` variant: full-height link tabs for a top bar (with tabs-link.svelte and tabs-nav.svelte); its indicator is the underline (#8).
				nav: "h-full! gap-0 rounded-none bg-transparent p-0 before:top-[calc(var(--tabs-indicator-top)+var(--tabs-indicator-height)-2px)] before:h-0.5 before:bg-primary",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	});

	export type TabsListVariant = VariantProps<typeof tabsListVariants>["variant"];
</script>

<script lang="ts">
	import { Tabs as TabsPrimitive } from "bits-ui";
	import { cn } from "#lib/utils.js";
	// Local: sliding active indicator (#8).
	import { trackIndicator } from "./tabs-motion.js";

	let {
		ref = $bindable(null),
		variant = "default",
		class: className,
		...restProps
	}: TabsPrimitive.ListProps & {
		variant?: TabsListVariant;
	} = $props();

	// Local: sliding active indicator (#8).
	$effect(() => (ref ? trackIndicator(ref) : undefined));
</script>

<TabsPrimitive.List
	bind:ref
	data-slot="tabs-list"
	data-variant={variant}
	class={cn(tabsListVariants({ variant }), className)}
	{...restProps}
/>
