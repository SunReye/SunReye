<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import { cn } from "#lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: DialogPrimitive.OverlayProps = $props();
</script>

<DialogPrimitive.Overlay
	bind:ref
	data-slot="dialog-overlay"
	// Local: duration and easing from the motion item, not upstream's duration-100 and CSS `ease` (ADR 0003, #38).
	// Local: glass-scrim (tint, blur and grain from the theme item's tokens, solid where blur is unsupported) instead of upstream's bg-black/10 and backdrop-blur-xs (#39).
	class={cn("data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 glass-scrim duration-(--motion-base) ease-(--motion-ease) fixed inset-0 isolate z-50", className)}
	{...restProps}
/>
