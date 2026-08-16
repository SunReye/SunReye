<script lang="ts">
	// The ⤢ / ⤡ toggle, shared by the section card's header and the standalone
	// chart frame — the icon, the label and the state read all flip together, so
	// writing them twice was three ternaries in each template and both over the
	// complexity gate.
	import ArrowsOut from 'phosphor-svelte/lib/ArrowsOut';
	import ArrowsIn from 'phosphor-svelte/lib/ArrowsIn';
	import * as m from '$lib/paraglide/messages';
	import type { FullscreenBox } from '$lib/charts/fullscreen.svelte';
	import { TAP } from '$lib/layout/tokens';

	let { screen, class: extra = '' }: { screen: FullscreenBox; class?: string } = $props();

	const label = $derived(screen.expanded ? m.chart_exit_fullscreen() : m.chart_fullscreen());
</script>

<!-- A bare 16px icon like the collapse caret beside it, so TAP is the whole hit
     area: 44px square, measured by `tapTargetPx` in the suite. -->
<button
	type="button"
	class="{TAP} {extra} text-muted-foreground transition-colors hover:text-foreground"
	onclick={screen.toggle}
	title={label}
>
	{#if screen.expanded}
		<ArrowsIn class="size-4" />
	{:else}
		<ArrowsOut class="size-4" />
	{/if}
	<span class="sr-only">{label}</span>
</button>
