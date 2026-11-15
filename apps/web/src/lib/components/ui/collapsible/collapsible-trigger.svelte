<script lang="ts">
	import { Collapsible as CollapsiblePrimitive } from "bits-ui";
	// Local: chevron turn on the open state (#38).
	import { cn } from "#lib/utils.js";

	// Local: `class` is merged with the chevron turn below.
	let { ref = $bindable(null), class: className, ...restProps }: CollapsiblePrimitive.TriggerProps = $props();
</script>

<CollapsiblePrimitive.Trigger
	bind:ref
	data-slot="collapsible-trigger"
	// Local: a lucide chevron-down that is a direct child of the trigger turns over while it is open, on the default transition (#38).
	class={cn("[&>.lucide-chevron-down]:transition-transform [&[data-state=open]>.lucide-chevron-down]:rotate-180", className)}
	{...restProps}
/>
