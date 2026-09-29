<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { ACTION_LABEL, type DeviceActionId, actionsFor } from './device-actions-logic';
	import DeviceActionButton from './device-action-button.svelte';
	import type { DeviceHandlers, DeviceView } from './device-types';
	import RowOverflowMenu, { type OverflowItem } from './row-overflow-menu.svelte';

	// The controls a row offers. WHICH ones, in what order and which one is
	// visible is decided in `./device-actions-logic.ts`; this renders the primary
	// one as a button and the rest into the row's overflow menu.
	//
	// The split that matters: EDIT opens the addressing dialog (gateway, unit id,
	// profile) and only a Modbus row has any of those; RENAME opens the name-only
	// dialog, which is exactly what the narrowed server gate allows on a coded or
	// a virtual row (#219).
	let {
		device,
		busy,
		handlers
	}: {
		device: DeviceView;
		busy: boolean;
		handlers: DeviceHandlers;
	} = $props();

	const run = (id: DeviceActionId) => handlers[id](device);

	const actions = $derived(actionsFor(device));
	const primary = $derived(actions.find((a) => a.placement === 'primary'));
	const menu = $derived<OverflowItem[]>(
		actions
			.filter((a) => a.placement === 'menu')
			.map((a) => ({
				id: a.id,
				label: ACTION_LABEL[a.id](),
				destructive: a.id === 'delete',
				disabled: a.blocked,
				hint: a.blocked ? m.devices_polled_blocked_hint() : undefined,
				onSelect: () => run(a.id)
			}))
	);
</script>

<div class="flex shrink-0 items-center gap-1">
	{#if primary}
		<DeviceActionButton action={primary} {busy} onclick={() => run(primary.id)} />
	{/if}
	<RowOverflowMenu
		label={m.devices_more_actions({ name: device.name })}
		items={menu}
		disabled={busy}
	/>
</div>
