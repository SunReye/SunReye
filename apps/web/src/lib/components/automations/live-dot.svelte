<script lang="ts">
	// Breathing status dot + label: emerald while the stream socket is live,
	// muted while (re)connecting. The ping halo respects reduced-motion.
	import { prefersReducedMotion } from 'svelte/motion';
	import * as m from '$lib/paraglide/messages';

	let { connected }: { connected: boolean } = $props();

	const breathing = $derived(connected && !prefersReducedMotion.current);
	const dotClass = $derived(connected ? 'bg-emerald-500' : 'bg-muted-foreground/40');
	const label = $derived(connected ? m.automations_live() : m.automations_connecting());
</script>

<!-- `data-slot` so a spec can assert the indicator is present — or, on a page
     that deliberately carries none, absent. The label alone is not a handle:
     /history's range control has a "Live" preset that is a different thing. -->
<span data-slot="live-dot" class="flex items-center gap-1.5 font-medium">
	<span class="relative flex size-2">
		{#if breathing}
			<span
				class="absolute inline-flex h-full w-full rounded-full bg-emerald-500/50 motion-safe:animate-ping [animation-duration:2.5s]"
			></span>
		{/if}
		<span class="relative inline-flex size-2 rounded-full transition-colors {dotClass}"></span>
	</span>
	{label}
</span>
