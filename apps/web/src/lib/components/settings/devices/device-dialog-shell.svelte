<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';

	// The frame both settings dialogs on this panel share: a scrollable dialog
	// card, a titled header, and one form inside it. Its own component because
	// the two had drifted apart once already — one closed on `bind:open`, the
	// other on `onOpenChange`, and only one of them capped its height.
	let {
		open,
		title,
		description,
		onClose,
		onsubmit,
		children
	}: {
		open: boolean;
		title: string;
		description: string;
		/** Called for every dismissal — the backdrop, Escape, and Cancel. */
		onClose: () => void;
		onsubmit: (event: SubmitEvent) => void;
		children: Snippet;
	} = $props();
</script>

<Dialog.Root {open} onOpenChange={(v) => !v && onClose()}>
	<Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-4" {onsubmit}>
			{@render children()}
		</form>
	</Dialog.Content>
</Dialog.Root>
