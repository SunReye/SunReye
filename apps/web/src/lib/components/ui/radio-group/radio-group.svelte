<script lang="ts">
	import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
	import { cn } from "#lib/utils.js";
	import { haptics } from "#lib/haptics.ts";

	let {
		ref = $bindable(null),
		class: className,
		value = $bindable(""),
		...restProps
	}: RadioGroupPrimitive.RootProps = $props();

	// Local: a pick of another option ticks (ADR 21 "One behaviour, one component"). bits-ui writes
	// the value on a user's pick only, the chosen one again too. After the caller.
	function pick(next: string): void {
		const changed = next !== value;

		value = next;

		if (changed) haptics.selection();
	}
</script>

<RadioGroupPrimitive.Root
	bind:ref
	bind:value={() => value, pick}
	data-slot="radio-group"
	class={cn("grid gap-3 w-full", className)}
	{...restProps}
/>
