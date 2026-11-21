<script lang="ts">
	import { Checkbox as CheckboxPrimitive } from "bits-ui";
	import CheckIcon from '@lucide/svelte/icons/check';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import { cn, type WithoutChildrenOrChild } from "#lib/utils.js";
	import { haptics } from "#lib/haptics.ts";

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		indeterminate = $bindable(false),
		class: className,
		onCheckedChange,
		...restProps
	}: WithoutChildrenOrChild<CheckboxPrimitive.RootProps> = $props();

	// Local: the toggle's `selection` lives here, so no caller plays it (ADR 21). bits-ui calls
	// this on a user's change only; after the caller, so a change it writes is felt as written.
	function changed(next: boolean): void {
		onCheckedChange?.(next);
		haptics.selection();
	}
</script>

<CheckboxPrimitive.Root
	bind:ref
	data-slot="checkbox"
	class={cn(
		// Local: corners follow --radius (ADR 21), not upstream's 4px. The box fills in on the default transition (--motion-fast), not just its ring: background, border and shadow, not upstream's transition-shadow (#38); no shadow-xs, a checkbox is a dense surface (#58). A 44 px hit area on touch (ADR 21, #750).
		"border-input dark:bg-input/30 data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary data-checked:border-primary aria-invalid:aria-checked:border-primary aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 flex size-4 items-center justify-center rounded-lg border transition-[color,background-color,border-color,box-shadow] group-has-disabled/field:opacity-50 focus-visible:ring-3 aria-invalid:ring-3 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input group-has-[:focus-visible]/field-label:data-checked:border-primary peer relative shrink-0 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 touch:after:-inset-4 disabled:cursor-not-allowed disabled:opacity-50",
		// Local: the border and fill answer the pointer, fading on the transition above (#37).
		"not-data-checked:hover:border-ring/50 data-checked:hover:bg-primary/80",
		className
	)}
	bind:checked
	onCheckedChange={changed}
	bind:indeterminate
	{...restProps}
>
	{#snippet children({ checked, indeterminate })}
		<div
			data-slot="checkbox-indicator"
			// Local: no transition-none (upstream's): the tick and the dash below scale in on the spring and fade on the default transition (#38, #47).
			class="[&>svg]:size-3.5 grid place-content-center text-current"
		>
			<!-- Local: the tick and the dash stay rendered, stacked, and scale and fade with the state instead of being swapped in and out (#38). -->
			<CheckIcon data-shown={checked} class="col-start-1 row-start-1 scale-50 opacity-0 transition-spring data-[shown=true]:scale-100 data-[shown=true]:opacity-100" />
			<MinusIcon data-shown={indeterminate && !checked} class="col-start-1 row-start-1 scale-50 opacity-0 transition-spring data-[shown=true]:scale-100 data-[shown=true]:opacity-100" />
		</div>
	{/snippet}
</CheckboxPrimitive.Root>
