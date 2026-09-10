<script lang="ts">
	import { type DeviceActionId, actionsFor } from './device-actions-logic';
	import DeviceActionButton from './device-action-button.svelte';
	import type { DeviceView } from './device-types';

	// The controls a row offers. WHICH ones, and in what order, is decided in
	// `./device-actions-logic.ts` — a rule with boundaries (a retired row, the
	// polled row, an integration with no page of its own) belongs somewhere a
	// test can reach it, not in an `{#if}` chain. Each control renders itself.
	//
	// The split that matters: EDIT opens the addressing dialog (gateway, unit id,
	// profile) and only a Modbus row has any of those; RENAME opens the name-only
	// dialog, which is exactly what the narrowed server gate allows on a coded or
	// a virtual row (#219). Before that narrowing those rows offered a link and
	// nothing else — an EVCC loadpoint could not be renamed at all.
	let {
		device,
		busy,
		onEdit,
		onRename,
		onRetire,
		onRestore
	}: {
		device: DeviceView;
		busy: boolean;
		onEdit: (device: DeviceView) => void;
		onRename: (device: DeviceView) => void;
		onRetire: (device: DeviceView) => void;
		onRestore: (device: DeviceView) => void;
	} = $props();

	// `configure` is a link and runs nothing.
	const RUN: Record<DeviceActionId, (device: DeviceView) => void> = {
		restore: onRestore,
		edit: onEdit,
		rename: onRename,
		configure: () => {},
		retire: onRetire
	};

	const actions = $derived(actionsFor(device));
</script>

<div class="flex shrink-0 flex-wrap items-center gap-2">
	{#each actions as action (action.id)}
		<DeviceActionButton {action} {busy} onclick={() => RUN[action.id](device)} />
	{/each}
</div>
