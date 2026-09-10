<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as m from '$lib/paraglide/messages';
	import { retiredByRemoving } from './add-device-logic';
	import type { DeviceView, IntegrationView } from './device-types';

	// The confirmation before an integration is un-configured. Same shape as
	// `./retire-dialog.svelte` — open while the subject is set, the parent clears
	// it on cancel and acts on confirm.
	//
	// It NAMES what leaves service with it. `DELETE /api/integrations/:id`
	// retires the devices the integration provisioned (an EVCC ingest's
	// loadpoints), because their readings are a foreign key away from a year of
	// `metrics_raw` rows; a Remove that silently retires two chargers is the
	// wrong surprise, and nothing on the row lets the operator see it coming.
	// Which devices those are is `retiredByRemoving`'s decision, and its test's.
	let {
		integration,
		devices,
		busy,
		onCancel,
		onConfirm
	}: {
		integration: IntegrationView | null;
		devices: readonly DeviceView[];
		busy: boolean;
		onCancel: () => void;
		onConfirm: () => void;
	} = $props();

	const label = $derived(integration?.label ?? '');
	const retiring = $derived(integration ? retiredByRemoving(integration, devices) : []);
	const names = $derived(retiring.map((d) => d.name).join(', '));
</script>

<Dialog.Root open={integration !== null} onOpenChange={(v) => !v && onCancel()}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.devices_integration_remove_title({ label })}</Dialog.Title>
			<Dialog.Description>{m.devices_integration_remove_body()}</Dialog.Description>
		</Dialog.Header>
		{#if retiring.length > 0}
			<p class="text-sm text-muted-foreground" data-retires>
				{m.devices_integration_remove_retires({ names })}
			</p>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={onCancel}>{m.action_cancel()}</Button>
			<Button variant="destructive" disabled={busy} onclick={onConfirm}>
				{m.devices_integration_action_remove()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
