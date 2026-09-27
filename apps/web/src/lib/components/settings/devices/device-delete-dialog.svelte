<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as m from '$lib/paraglide/messages';
	import { type DeviceRoster, type WriteOutcome, statedReason } from './device-roster';
	import type { DeviceView } from './device-types';

	// Deleting a device, and the answer when the server says no.
	//
	// The server deletes only a device that never recorded a reading — every
	// reading references its device ON DELETE RESTRICT, on purpose. Rather than
	// scanning years of history to decide whether to show the button, the dialog
	// asks, and a `history` refusal turns it into the offer that DOES apply:
	// retire it, keeping the readings. A device already retired gets told it
	// stays that way.
	let {
		device = $bindable(null),
		roster,
		onRetire
	}: {
		/** Open while set; cleared on close. */
		device?: DeviceView | null;
		roster: DeviceRoster;
		onRetire: (device: DeviceView) => void;
	} = $props();

	let busy = $state(false);
	/** The server refused because the device has readings. */
	let hasHistory = $state(false);

	const name = $derived(device?.name ?? '');
	const retired = $derived(device?.retiredAt != null);
	const title = $derived(
		hasHistory ? m.devices_delete_history_title({ name }) : m.devices_delete_title({ name })
	);
	const body = $derived(
		!hasHistory
			? m.devices_delete_body()
			: retired
				? m.devices_delete_history_retired_body()
				: m.devices_delete_history_body()
	);

	function close() {
		device = null;
		hasHistory = false;
	}

	/** What happens after the server answered — everything but the history case closes. */
	function settle(target: DeviceView, outcome: WriteOutcome<unknown>) {
		if (outcome.kind === 'has-history') {
			hasHistory = true;
			return;
		}
		close();
		if (outcome.kind !== 'ok') {
			toast.error(m.devices_toast_delete_failed({ error: statedReason(outcome) }));
			return;
		}
		toast.success(m.devices_toast_deleted({ name: target.name }));
	}

	async function confirm() {
		const target = device;
		if (!target) return;
		busy = true;
		const outcome = await roster.delete(target.id);
		busy = false;
		settle(target, outcome);
	}

	function retireInstead() {
		const target = device;
		close();
		if (target) onRetire(target);
	}
</script>

<Dialog.Root open={device !== null} onOpenChange={(v) => !v && close()}>
	<Dialog.Content data-device-delete>
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{body}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			{#if !hasHistory}
				<Button variant="outline" onclick={close}>{m.action_cancel()}</Button>
				<Button variant="destructive" disabled={busy} onclick={confirm}>
					{m.devices_action_delete()}
				</Button>
			{:else if !retired}
				<Button variant="outline" onclick={close}>{m.action_cancel()}</Button>
				<Button onclick={retireInstead}>{m.devices_retire_instead()}</Button>
			{:else}
				<Button onclick={close}>{m.action_close()}</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
