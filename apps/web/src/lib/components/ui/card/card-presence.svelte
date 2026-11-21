<!--
	Local (not from the registry, #837): around a card that data shows or takes away while its screen
	is shown. The card opens or closes its height, fading, and what stands below glides with it
	(ADR 21 "One behaviour, one component"). The screen keeps its own `{#if}` or `{#each}` around
	it: the transition is local, so a card there on the screen's first render, or one that comes and
	goes with its screen, does so at once. It is the column's child in the card's place, so what
	places the card in its column (`shrink-0`, `min-w-0`) goes on it.
-->
<script lang="ts">
	import type { Snippet } from "svelte";
	import type { ClassValue } from "svelte/elements";
	import { presence } from "./presence.ts";

	let { class: className, children }: { class?: ClassValue; children: Snippet } = $props();
</script>

<div data-slot="card-presence" class={className} transition:presence>
	{@render children()}
</div>
