<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import TrashIcon from 'phosphor-svelte/lib/Trash';

	// Trailing destructive action of a settings table row (revoke a key, remove a
	// user). Icon-only, so the accessible name has to be passed in.
	let {
		label,
		onclick,
		disabled = false
	}: { label: string; onclick: () => void; disabled?: boolean } = $props();
</script>

<Button variant="ghost" size="icon" {onclick} {disabled} aria-label={label}>
	<TrashIcon class="size-4" />
</Button>
