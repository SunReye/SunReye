<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { CapabilityName } from '$lib/capabilities';
	import { coreCapabilities } from '$lib/capabilities.svelte';

	// What sits behind an area the core may not serve: nothing renders while the core reports it
	// absent, and everything does while it has not answered (see `hasCapability`).
	let { name, children }: { name: CapabilityName; children: Snippet } = $props();
</script>

{#if coreCapabilities.has(name)}
	{@render children()}
{/if}
