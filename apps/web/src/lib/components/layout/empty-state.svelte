<script lang="ts">
	// The "nothing here yet" block. The same bordered, centred, muted box was
	// copy-pasted verbatim into six files (mqtt-form, inverter-form, tariff-form,
	// statistics-body, history, controls), which is why one of them could drift
	// without anyone noticing.
	//
	// Height is a floor (`min-h-32`), not the copied fixed 160px: a fixed height
	// reserves a fifth of a phone screen to say nothing, and clips a two-line
	// message that carries an action button.
	import type { Component, Snippet } from 'svelte';

	let {
		message,
		icon: Icon,
		action
	}: {
		message: string;
		/** Optional phosphor icon above the message. */
		icon?: Component<{ class?: string }>;
		/** Optional recovery affordance — the button that makes the state non-empty. */
		action?: Snippet;
	} = $props();
</script>

<div
	class="flex min-h-32 flex-col items-center justify-center gap-3 border border-border p-4 text-center text-sm text-muted-foreground"
>
	{#if Icon}
		<Icon class="size-6 opacity-60" />
	{/if}
	<p>{message}</p>
	{#if action}
		{@render action()}
	{/if}
</div>
