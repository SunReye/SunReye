<script lang="ts">
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { CatalogEntryView } from './add-wizard';
	import { fieldLabel } from './field-label';
	import WizardField from './wizard-field.svelte';

	// A CODED ENTRY'S SETTINGS, rendered from the server's own description of
	// them — so a new integration is a server change and no edit here, which is
	// the whole point of the catalog.
	//
	// Its own component because two surfaces ask for exactly this and neither
	// asks for the other's: the wizard's step 3 (which for a DEVICE renders the
	// add dialog's form instead) and the edit dialog for a configured row (which
	// has no device arm at all).
	//
	// An entry with no fields — a coded thing that configures itself — is a step
	// with nothing to answer, and says so rather than showing a blank card.
	let {
		entry,
		values = $bindable()
	}: {
		/** Null when this build has no entry for the row's kind, or before step 2. */
		entry: CatalogEntryView | null;
		values: Record<string, unknown>;
	} = $props();

	const fields = $derived(entry?.fields ?? []);
</script>

{#if fields.length === 0}
	<EmptyState message={m.wizard_settings_none()} />
{:else}
	<div class="flex flex-col gap-4">
		{#each fields as field (field.name)}
			<WizardField {field} label={fieldLabel(field.name)} bind:value={values[field.name]} />
		{/each}
	</div>
{/if}
