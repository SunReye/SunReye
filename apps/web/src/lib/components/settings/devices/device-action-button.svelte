<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { ACTION_LABEL, type DeviceAction } from './device-actions-logic';

	// The ONE visible control of a device row — the rest sit behind the row's
	// overflow menu (`./device-actions.svelte`).
	let {
		action,
		busy,
		onclick
	}: {
		action: DeviceAction;
		busy: boolean;
		onclick: () => void;
	} = $props();
</script>

<Button
	variant="outline"
	size="sm"
	class="h-9 sm:h-8"
	disabled={busy || action.blocked}
	data-action={action.id}
	{onclick}
>
	{ACTION_LABEL[action.id]()}
</Button>
