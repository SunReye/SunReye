<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = "default",
		// Local: `interactive` opts into hover, press and pointer feedback (#37).
		interactive = false,
		...restProps
		// Local: `interactive` in the props type.
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { size?: "default" | "sm"; interactive?: boolean } = $props();
</script>

<div
	bind:this={ref}
	data-slot="card"
	data-size={size}
	// Local: elevation step 1 instead of upstream's shadow-xs (#58); an `interactive` card rises 3px on hover and takes step 2, glows, presses in a little (a large surface; step 2 gives way to the pressed shadow) and shows the pointer; a static card stays still (#37, #47, #58).
	class={cn("ring-foreground/10 bg-card text-card-foreground gap-(--card-spacing) overflow-hidden rounded-xl py-(--card-spacing) text-sm elevation-1 ring-1 [--card-spacing:--spacing(6)] has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(4)] *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl group/card flex flex-col", interactive && "cursor-pointer transition-press glow-hover hover:elevation-2 focus-visible:elevation-2 active:elevation-press motion-safe:hover:-translate-y-[3px] motion-safe:active:translate-y-0 motion-safe:active:scale-(--press-scale-soft)", className)}
	{...restProps}
>
	{@render children?.()}
</div>
