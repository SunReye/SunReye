<script lang="ts">
	import { Switch as SwitchPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "#lib/utils.js";
	import { haptics } from "#lib/haptics.ts";

	let {
		ref = $bindable(null),
		class: className,
		checked = $bindable(false),
		onCheckedChange,
		size = "default",
		...restProps
	}: WithoutChildrenOrChild<SwitchPrimitive.RootProps> & {
		size?: "sm" | "default";
	} = $props();

	// Local: the toggle's `selection` lives here, so no caller plays it (ADR 21). bits-ui calls
	// this on a user's change only; after the caller, so a switch that turns haptics on is felt.
	function changed(next: boolean): void {
		onCheckedChange?.(next);
		haptics.selection();
	}
</script>

<SwitchPrimitive.Root
	bind:ref
	bind:checked
	onCheckedChange={changed}
	data-slot="switch"
	data-size={size}
	class={cn(
		// Local: boxy (ADR 21): --radius corners, a shallow well instead of shadow-xs, only colours fade (not upstream's transition-all), and a 44 px hit area on touch (#750).
		"data-checked:bg-primary data-unchecked:bg-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 dark:data-unchecked:bg-input/80 shrink-0 rounded-sm border border-transparent bevel-well focus-visible:ring-3 aria-invalid:ring-3 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:border-transparent data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] peer group/switch relative inline-flex items-center transition-[background-color,border-color,box-shadow] outline-none after:absolute after:-inset-x-3 after:-inset-y-2 touch:after:-inset-y-3.5 data-disabled:cursor-not-allowed data-disabled:opacity-50",
		className
	)}
	{...restProps}
>
	<SwitchPrimitive.Thumb
		data-slot="switch-thumb"
		class={cn(
			// Local: a boxy thumb that slides on the soft spring over --motion-base, a transform only (ADR 21, #750).
			"bg-background dark:data-unchecked:bg-foreground dark:data-checked:bg-primary-foreground rounded-sm group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%_-_2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%_-_2px)] group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 pointer-events-none block ring-0 transition-transform duration-(--motion-base) ease-(--motion-spring-soft)",
			"rtl:data-[state=checked]:translate-x-[calc(-100%)]"
		)}
	/>
</SwitchPrimitive.Root>
