<script lang="ts">
	import type { Component } from 'svelte';
	import type { Pathname } from '$app/types';
	import { resolve } from '$lib/resolve';

	// One entry of the settings nav. `extra` carries the per-layout spacing, so
	// the desktop rail and the mobile scroll row share this markup.
	let {
		href,
		label,
		icon: Icon,
		active,
		extra
	}: {
		href: Pathname;
		label: string;
		icon: Component;
		active: boolean;
		extra: string;
	} = $props();

	const stateClass = $derived(
		active
			? 'bg-muted font-medium text-foreground'
			: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
	);
	const ariaCurrent = $derived(active ? 'page' : undefined);
	const iconWeight = $derived(active ? 'fill' : 'regular');
</script>

<a
	href={resolve(href)}
	aria-current={ariaCurrent}
	class="flex items-center rounded-md text-sm transition-colors {extra} {stateClass}"
>
	<Icon class="size-4 shrink-0" weight={iconWeight} />
	<span class="truncate">{label}</span>
</a>
