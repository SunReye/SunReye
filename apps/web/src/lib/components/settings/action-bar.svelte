<script lang="ts">
	import type { Snippet } from 'svelte';

	// The standard settings action row. It sits at the top of a form and sticks
	// below whatever page chrome is already there, so the primary Save (and any
	// Test) stay reachable without scrolling past the body. `info` holds muted,
	// left-aligned content such as a test result or an admin-only note.
	//
	// `--sticky-top` is the shell's contract (`(app)/+layout.svelte`): the first
	// y a sticky bar may claim. `top-0` was two bugs at once — the document is
	// what scrolls, so this bar never stuck at all, and at `z-20` it dragged its
	// backdrop-blur over the header every time it passed. The `0px` fallback is
	// for /setup, which renders this outside the app shell and has no header.
	// `z-20` is the shell's tier for a sticky in-page bar.
	let { info, children }: { info?: Snippet; children: Snippet } = $props();
</script>

<div
	data-slot="settings-action-bar"
	class="sticky top-[var(--sticky-top,0px)] z-20 flex flex-col gap-2 border-b border-border bg-background/85 pb-3 backdrop-blur supports-backdrop-filter:bg-background/65 sm:flex-row sm:items-center sm:gap-3"
>
	<div class="min-w-0 text-sm sm:mr-auto">
		{#if info}{@render info()}{/if}
	</div>
	<div class="flex items-center justify-end gap-2">
		{@render children()}
	</div>
</div>
