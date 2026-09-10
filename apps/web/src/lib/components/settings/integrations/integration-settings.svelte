<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';
	import type { CatalogEntryView } from '../wizard/add-wizard';
	import SettingsStep from '../wizard/settings-step.svelte';

	// The integration's settings, edited in place.
	//
	// The WIZARD'S own step over the SERVER'S own field descriptions — no field
	// is restated here. The server validates a write against the catalog entry
	// the row's kind resolves to, so a second form would be one that offers what
	// the route then refuses, which is the same defect as no validation at all:
	// the operator sees a page that lies.
	//
	// Its kind and its connection are NOT here. They are the row's identity and
	// `PATCH /api/integrations/:id` answers 409 for either.
	let {
		entry,
		values = $bindable(),
		busy,
		onSave
	}: {
		/** Null when this build has no catalog entry for the row; Save is then off. */
		entry: CatalogEntryView | null;
		values: Record<string, unknown>;
		busy: boolean;
		onSave: (params: Record<string, unknown>) => void;
	} = $props();

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onSave({ ...values });
	}
</script>

<form class="flex flex-col gap-4" onsubmit={submit}>
	<SettingsStep {entry} bind:values />
	<div class="flex justify-end">
		<Button type="submit" class="h-9 sm:h-8" disabled={busy || entry === null}>
			{m.action_save()}
		</Button>
	</div>
</form>
