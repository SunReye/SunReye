<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { SLUG_MAX } from '$lib/slug';
	import * as m from '$lib/paraglide/messages';
	import { nameProblem } from './add-device-logic';

	// Rename in place. The slug is frozen, so only the display name moves; the
	// same name rules as the add dialog apply so the two cannot disagree.
	let {
		current,
		busy,
		onSave,
		onCancel
	}: {
		current: string;
		busy: boolean;
		onSave: (name: string) => Promise<void>;
		onCancel: () => void;
	} = $props();

	// The draft starts from the name as it is when editing begins, on purpose.
	// svelte-ignore state_referenced_locally
	let draft = $state(current);
	const trimmed = $derived(draft.trim());
	const ok = $derived(nameProblem(draft) === null && trimmed !== current);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (ok) await onSave(trimmed);
	}
</script>

<form class="flex flex-wrap items-center gap-2" onsubmit={submit}>
	<Input
		class="h-9 w-full sm:h-8 sm:w-64"
		bind:value={draft}
		maxlength={SLUG_MAX}
		autocomplete="off"
		aria-label={m.devices_field_name()}
	/>
	<Button type="submit" size="sm" disabled={!ok || busy}>{m.action_save()}</Button>
	<Button type="button" size="sm" variant="ghost" onclick={onCancel}>{m.action_cancel()}</Button>
</form>
