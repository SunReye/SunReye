<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';
	import { type Catalog, catalogEntryFor } from '../wizard/add-wizard';
	import SettingsStep from '../wizard/settings-step.svelte';
	import DialogShell from './device-dialog-shell.svelte';
	import type { IntegrationView } from './device-types';

	// A configured integration's SETTINGS, edited in place.
	//
	// The same fields the wizard's third step asks for, rendered by the same
	// component off the same catalog: the server validates a write against the
	// catalog entry the row's kind resolves to, so a second form here would be a
	// form that offers what the route then refuses.
	//
	// Its kind and its connection are NOT here. They are the row's identity and
	// `PATCH /api/integrations/:id` answers 409 for either — re-pointing an EVCC
	// ingest would move a subscription off the very broker its loadpoints are
	// bound to, while their history stays keyed to them.
	let {
		integration = $bindable(null),
		catalog,
		onSave
	}: {
		/** The row being configured, or null when the dialog is closed. */
		integration?: IntegrationView | null;
		catalog: Catalog;
		/** Runs the PATCH. The parent owns every request on this panel. */
		onSave: (integration: IntegrationView, params: Record<string, unknown>) => void;
	} = $props();

	let values = $state<Record<string, unknown>>({});
	/** The row the fields were last seeded from, so re-opening reseeds exactly once. */
	let seeded: number | null = null;

	// Null when this build has no entry for the row — a database migrated ahead
	// of the binary. `catalogEntryFor` owns that answer, and the Save button is
	// what acts on it: the server refuses to validate such a row's settings too
	// (409), so an editable form here would be one no write can land.
	const entry = $derived(catalogEntryFor(catalog, integration?.kind));
	const label = $derived(integration?.label ?? '');

	$effect(() => {
		const row = integration;
		if (row === null) {
			seeded = null;
			return;
		}
		if (seeded === row.id) return;
		seeded = row.id;
		// The ROW's stored settings, not the catalog's defaults: this is an edit.
		values = { ...row.params };
	});

	function close() {
		integration = null;
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const row = integration;
		if (row === null) return;
		close();
		onSave(row, { ...values });
	}
</script>

<DialogShell
	open={integration !== null}
	title={m.devices_integration_edit_title({ label })}
	description={m.devices_integration_edit_description()}
	onClose={close}
	onsubmit={submit}
>
	<SettingsStep {entry} bind:values />
	<div class="flex justify-end gap-2">
		<Button type="button" variant="ghost" onclick={close}>{m.action_cancel()}</Button>
		<Button type="submit" disabled={entry === null}>{m.action_save()}</Button>
	</div>
</DialogShell>
