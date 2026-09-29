<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import DialogPortal from "./dialog-portal.svelte";
	import type { Snippet } from "svelte";
	import * as Dialog from "./index.js";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import type { ComponentProps } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import XIcon from 'phosphor-svelte/lib/X';

	let {
		ref = $bindable(null),
		class: className,
		bodyClass,
		portalProps,
		children,
		showCloseButton = true,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DialogPortal>>;
		children: Snippet;
		showCloseButton?: boolean;
		/** Classes for the scrolling body, for a dialog that owns its own rhythm. */
		bodyClass?: string;
	} = $props();
</script>

<!--
	Two boxes, not one. The outer box is the dialog: it is what is centred, what
	is capped, and what the close button is pinned to. Everything a consumer
	renders lives in the INNER box, which is the only thing that scrolls.

	It used to be one grid that grew as tall as its content, which cost three
	defects on a phone at once:

	  * A dialog taller than the screen had no way to reach its own bottom —
	    the custom-chart editor clipped its footer and its Save button with it.
	    The cap is `svh`, not `vh`: mobile browser chrome makes `vh` taller
	    than what is actually on screen, which is how a capped dialog still
	    ends up with its last row under the address bar.
	  * That grid's single `auto` column takes its minimum from its items'
	    min-content, so one unbreakable child widened the track past the box and
	    the whole dialog scrolled SIDEWAYS. `minmax(0,1fr)` is a column that
	    cannot exceed the box; a child too wide for it scrolls inside its own
	    box instead of dragging the dialog with it.
	  * When the whole box scrolled, the title and the X scrolled away with it.
	    The close button now hangs off the outer box, so scrolling cannot move
	    it, and `Dialog.Header` is made sticky here — the header of a scrolling
	    body belongs to the primitive, not to each of the twelve consumers.

	A short dialog is untouched: `auto` overflow shows no scrollbar, the cap is
	never reached, and the close button sits where it always sat.
-->
<DialogPortal {...portalProps}>
	<Dialog.Overlay />
	<DialogPrimitive.Content
		bind:ref
		data-slot="dialog-content"
		class={cn(
			"bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-foreground/10 flex max-h-[calc(100svh-2rem)] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl text-sm ring-1 duration-100 sm:max-w-sm fixed top-1/2 left-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 outline-none",
			className
		)}
		{...restProps}
	>
		<div
			data-slot="dialog-body"
			class={cn(
				"grid min-h-0 grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto overscroll-contain p-4",
				// The header rides the top of the body while the body scrolls under
				// it. The negative margins let it cover the body's own padding, so
				// nothing shows through above or beside it; the matching padding
				// puts every edge back where it was.
				"[&>[data-slot=dialog-header]]:bg-popover [&>[data-slot=dialog-header]]:sticky [&>[data-slot=dialog-header]]:-top-4 [&>[data-slot=dialog-header]]:z-10 [&>[data-slot=dialog-header]]:-mx-4 [&>[data-slot=dialog-header]]:-mt-4 [&>[data-slot=dialog-header]]:-mb-2 [&>[data-slot=dialog-header]]:px-4 [&>[data-slot=dialog-header]]:pt-4 [&>[data-slot=dialog-header]]:pr-12 [&>[data-slot=dialog-header]]:pb-2",
				bodyClass
			)}
		>
			{@render children?.()}
		</div>
		{#if showCloseButton}
			<DialogPrimitive.Close data-slot="dialog-close">
				{#snippet child({ props })}
					<Button variant="ghost" class="absolute top-2 right-2 z-20" size="icon-sm" {...props}>
						<XIcon  />
						<span class="sr-only">Close</span>
					</Button>
				{/snippet}
			</DialogPrimitive.Close>
		{/if}
	</DialogPrimitive.Content>
</DialogPortal>
