<script lang="ts">
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { CatalogEntryView } from './add-wizard';
	import WizardField from './wizard-field.svelte';

	// STEP 3 — the entry's own settings, rendered from the field list the catalog
	// carries. An entry with no fields (a coded thing that configures itself) is
	// a step with nothing to answer, and says so rather than showing a blank card.
	let {
		entry,
		values = $bindable()
	}: {
		/** Null only if step 2 were skipped, which `blockedAt` prevents — a step
		    body still cannot assume its predecessor ran. */
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
			<WizardField {field} label={field.name} bind:value={values[field.name]} />
		{/each}
	</div>
{/if}
