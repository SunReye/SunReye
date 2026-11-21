<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	// Local: the interactive card is the app's one pressed surface (#836).
	import { Pressable } from "../pressable/index.js";
	// Local: a card's height glides when its content changes it (ADR 21, #837).
	import { glideHeight } from "./glide-height.ts";

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = "default",
		// Local: `element` gives the card a landmark or a form's semantics (#836).
		element = "div",
		// Local: `interactive` makes the card a button with hover, press and pointer feedback (#37, #836).
		interactive = false,
		// Local: every card is ambient glass (ADR 21 "One card"); `glass={false}` names a card that is not.
		glass = true,
		...restProps
		// Local: `element`, `interactive` and `glass` in the props type.
	}: WithElementRef<HTMLAttributes<HTMLElement>> & {
		size?: "default" | "sm";
		element?: "div" | "section" | "nav" | "aside" | "form" | "ul";
		interactive?: boolean;
		glass?: boolean;
	} = $props();

	// Local: elevation step 1 instead of upstream's shadow-xs (#58). While its height glides, its
	// content keeps its size, clipped (#837). A card that appears or leaves fades on its own
	// opacity, which `card-presence.svelte` sets from around it (#837).
	const base =
		"data-gliding:*:flex-none opacity-(--card-presence) ring-foreground/10 bg-card text-card-foreground gap-(--card-spacing) overflow-hidden rounded-xl py-(--card-spacing) text-sm elevation-1 ring-1 [--card-spacing:--spacing(6)] has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(4)] *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl group/card flex flex-col";

	// Local: an interactive card rises 3px on hover and takes step 2, glows, presses in a little (a large surface; step 2 gives way to the pressed shadow) and shows the pointer (#37, #47, #58).
	const press =
		"cursor-pointer text-left transition-press glow-hover hover:elevation-2 focus-visible:elevation-2 active:elevation-press motion-safe:hover:-translate-y-[3px] motion-safe:active:translate-y-0 motion-safe:active:scale-(--press-scale-soft)";
</script>

{#if interactive}
	<Pressable
		data-slot="card"
		data-size={size}
		class={cn(base, glass && "glass-ambient", press, className)}
		{...restProps}
		{@attach glideHeight}
	>
		{@render children?.()}
	</Pressable>
{:else}
	<svelte:element
		this={element}
		bind:this={ref}
		data-slot="card"
		data-size={size}
		class={cn(base, glass && "glass-ambient", className)}
		{...restProps}
		{@attach glideHeight}
	>
		{@render children?.()}
	</svelte:element>
{/if}
