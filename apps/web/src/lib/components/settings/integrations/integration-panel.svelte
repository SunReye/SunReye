<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import Section from '$lib/components/layout/section.svelte';
	import * as m from '$lib/paraglide/messages';
	import { resolve } from '$lib/resolve';
	import { providedBy } from '../devices/roster-groups';
	import { type WriteOutcome, failureText } from '../devices/device-roster';
	import { deviceRoster } from '../devices/device-roster.svelte';
	import type { IntegrationPatchBody, IntegrationView } from '../devices/device-types';
	import IntegrationRemoveDialog from '../devices/integration-remove-dialog.svelte';
	import { catalogEntryFor } from '../wizard/add-wizard';
	import IntegrationControls from './integration-controls.svelte';
	import IntegrationDevices from './integration-devices.svelte';
	import IntegrationLive from './integration-live.svelte';
	import IntegrationSettings from './integration-settings.svelte';
	import IntegrationSummary from './integration-summary.svelte';
	import { findIntegration } from './integration-detail';

	// ONE integration's page — the "inside" an integration did not have.
	//
	// The devices panel answers WHY IS NOTHING ARRIVING and groups by connection,
	// because a connection is the thing that fails. This answers the other
	// question the owner asked for ("click into EVCC and see all the loadpoints
	// and roles and data"): what this one integration is giving the plant. Both
	// are real; neither collapses into the other, which is why this is a
	// drilldown off a row rather than a replacement for the list.
	//
	// It reads the SAME two endpoints the devices panel does and picks its row
	// out of them, rather than asking for a `GET /api/integrations/:id` that does
	// not exist: the list is already the server's answer to "what is configured",
	// and a second shape of the same row is a second thing to keep in step.
	//
	// Every write is here. The children render.
	let { id }: { id: string | undefined } = $props();

	const roster = deviceRoster({ afterWrite: 'reload' });
	/** False until the integration list has answered once — "not yet" is not "gone". */
	let loaded = $state(false);
	let busy = $state(false);
	let removing = $state<IntegrationView | null>(null);
	/** The settings form's answers, seeded from the ROW once it arrives. */
	let values = $state<Record<string, unknown>>({});
	/** The row the form was last seeded from, so a reload reseeds exactly once. */
	let seeded: number | null = null;

	const integration = $derived(findIntegration(roster.integrations, id));
	const connection = $derived(
		roster.connections.find((c) => c.id === integration?.connectionId) ?? null
	);
	// Retired rows INCLUDED: a device nobody can see is a device nobody can
	// restore, and this page is the one place a retired loadpoint is explicable.
	const devices = $derived(integration ? providedBy(integration, roster.devices) : []);
	const entry = $derived(catalogEntryFor(roster.catalog, integration?.kind));
	/** The empty state's words, or none at all while the list is still in flight. */
	const missing = $derived(loaded ? m.integration_not_found() : '');

	onMount(async () => {
		await roster.load();
		loaded = true;
	});

	// The ROW's stored settings, not the catalog's defaults: this is an edit, and
	// a form that reset to `evcc` would silently undo an operator's topic root.
	$effect(() => {
		const row = integration;
		if (!row || seeded === row.id) return;
		seeded = row.id;
		values = { ...row.params };
	});

	/** A refused write, in the operator's language, with the server's own reason. */
	function refused(outcome: Exclude<WriteOutcome<unknown>, { kind: 'ok' }>) {
		toast.error(m.devices_integration_toast_failed({ error: failureText(outcome) }));
	}

	/** Both writes are the same PATCH with a different body, and end the same way. */
	async function patch(row: IntegrationView, body: IntegrationPatchBody) {
		busy = true;
		const outcome = await roster.patchIntegration(row.id, body);
		busy = false;
		if (outcome.kind !== 'ok') return refused(outcome);
		toast.success(m.devices_integration_toast_saved({ label: row.label }));
	}

	/**
	 * Removing the thing this page is ABOUT, so it leaves for the list rather
	 * than sitting on a row that no longer exists. The confirm names the devices
	 * it retires — the same `retiredByRemoving` decision the devices page's
	 * dialog uses, because it is the same dialog.
	 */
	async function confirmRemove() {
		const row = removing;
		removing = null;
		if (!row) return;
		busy = true;
		const outcome = await roster.removeIntegration(row.id, 'leave');
		busy = false;
		if (outcome.kind !== 'ok') return refused(outcome);
		toast.success(m.devices_integration_toast_removed({ label: row.label }));
		await goto(resolve('/settings/devices'), { replaceState: true });
	}
</script>

<a
	class="text-sm text-muted-foreground underline-offset-4 hover:underline"
	href={resolve('/settings/devices')}
>
	{m.integration_back()}
</a>

{#if integration}
	<Section title={integration.label} caption={m.integration_section_status()}>
		{#snippet actions()}
			<IntegrationControls
				{integration}
				{busy}
				onToggle={(enabled) => patch(integration, { enabled })}
				onRemove={() => (removing = integration)}
			/>
		{/snippet}
		<IntegrationSummary {integration} {connection} />
	</Section>

	<Section title={m.integration_section_live()}>
		<IntegrationLive {integration} />
	</Section>

	<Section title={m.integration_section_devices()}>
		<IntegrationDevices {devices} />
	</Section>

	<Section title={m.integration_section_settings()}>
		<IntegrationSettings
			{entry}
			{busy}
			bind:values
			onSave={(params) => patch(integration, { params })}
		/>
	</Section>
{:else}
	<!-- "Not yet" is not "gone": the list arrives over HTTP, and rendering the
	     404 copy before it lands would flash a wrong answer at every visitor. -->
	<EmptyState message={missing} />
{/if}

<IntegrationRemoveDialog
	integration={removing}
	devices={roster.devices}
	{busy}
	onCancel={() => (removing = null)}
	onConfirm={confirmRemove}
/>
